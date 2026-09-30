import type { FastifyInstance } from 'fastify';
import { prisma, paging } from '../db.js';
import {
  hashPassword, verifyPassword, issueTokenForUser, requireAuth, requirePerm,
  audit, actor, hasPermission,
} from '../services/auth.js';

/**
 * 登录与账号。
 *
 * 两条登录路径：
 *   1. 管理端：账号 + 密码（本文件实现）
 *   2. 企业平台扫码：/api/auth/sso/:provider —— 一期返回「未配置」，
 *      凭据填好后即可启用，登录流程和绑定关系已经打通
 *
 * 员工本人不发账号密码，只走企业平台身份或手机验证码（IdentityBinding.personId）。
 */
/**
 * 登录失败限流。
 *
 * 演示站密码公开，但代码是开源的，照搬去投产的人不会记得自己加。scrypt 每次校验
 * 要吃几十毫秒 CPU，不限的话既能暴力猜密码，也能把这台小机器打满。
 *
 * 两道闸，都只数失败：
 *   同一账号 15 分钟内失败 5 次 → 锁 15 分钟（挡定向猜某个账号）
 *   同一 IP  15 分钟内失败 30 次 → 锁 15 分钟（挡换着账号撞库）
 * 放内存里：单进程部署，重启清零可以接受，不值得为它引一个 Redis。
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_USER = 5;
const MAX_PER_IP = 30;
const failures = new Map<string, number[]>();

function recentFailures(key: string) {
  const now = Date.now();
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list); else failures.delete(key);
  return list;
}
function lockedFor(username: string, ip: string): number {
  const u = recentFailures(`u:${username.toLowerCase()}`);
  const i = recentFailures(`ip:${ip}`);
  const until = Math.max(
    u.length >= MAX_PER_USER ? u[u.length - MAX_PER_USER] + WINDOW_MS : 0,
    i.length >= MAX_PER_IP ? i[i.length - MAX_PER_IP] + WINDOW_MS : 0,
  );
  return Math.max(0, until - Date.now());
}
function recordFailure(username: string, ip: string) {
  const now = Date.now();
  for (const k of [`u:${username.toLowerCase()}`, `ip:${ip}`]) failures.set(k, [...recentFailures(k), now]);
  // 防止被随机账号名撑爆内存
  if (failures.size > 20000) failures.clear();
}

export default async function authRoutes(app: FastifyInstance) {
  /** 登录页需要知道有哪些可用的登录方式 */
  app.get('/api/auth/methods', async () => {
    const integrations = await prisma.integration.findMany({
      where: { capabilities: { contains: 'SSO' } },
      orderBy: { sortOrder: 'asc' },
    });
    return {
      local: true,
      sso: integrations.map((i) => ({
        provider: i.provider, nameZh: i.nameZh, nameEn: i.nameEn, nameId: i.nameId,
        enabled: i.enabled, status: i.status,
      })),
    };
  });

  app.post<{ Body: { username: string; password: string } }>('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body ?? ({} as any);
    // 类型也要卡：传个对象进来，Prisma 会直接抛 500
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
      return reply.code(400).send({ error: '请输入账号和密码' });

    // 先看锁，锁住时连密码都不校验 —— 否则 scrypt 的开销照样吃满
    const wait = lockedFor(username, req.ip);
    if (wait > 0) {
      const minutes = Math.ceil(wait / 60000);
      reply.header('Retry-After', Math.ceil(wait / 1000));
      return reply.code(429).send({ error: `登录失败次数过多，请 ${minutes} 分钟后再试`, retryAfterMinutes: minutes });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    // 用户不存在和密码错误给同一个提示，避免账号枚举
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      recordFailure(username, req.ip);
      await prisma.auditLog.create({
        data: { username, action: 'LOGIN_FAILED', detail: '账号或密码错误', ip: req.ip },
      });
      return reply.code(401).send({ error: '账号或密码不正确' });
    }
    failures.delete(`u:${username.toLowerCase()}`);

    const issued = await issueTokenForUser(user.id);
    if (!issued) return reply.code(401).send({ error: '账号已停用' });

    await prisma.auditLog.create({
      data: { userId: user.id, username: user.username, action: 'LOGIN', detail: '密码登录', ip: req.ip },
    });
    return issued;
  });

  /** 企业平台扫码登录入口。一期未配置，返回清楚的下一步 */
  app.get<{ Params: { provider: string } }>('/api/auth/sso/:provider', async (req, reply) => {
    const provider = req.params.provider.toUpperCase();
    const integ = await prisma.integration.findUnique({ where: { provider } });
    if (!integ) return reply.code(404).send({ error: `未知平台 ${provider}` });
    if (!integ.enabled) {
      return reply.code(503).send({
        error: `${integ.nameZh} 尚未启用`,
        hint: '请在「设置 → 集成对接」填入企业凭据并启用后再试',
        provider,
      });
    }
    return reply.code(501).send({
      error: `${integ.nameZh} 扫码登录待实现`,
      hint: '凭据已配置，接入该平台的 OAuth 回调即可启用；绑定关系表 IdentityBinding 已就绪',
    });
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const a = req.auth!;
    const user = await prisma.user.findUnique({
      where: { id: a.sub },
      include: { role: true, buildings: { include: { building: true } }, identities: true },
    });
    return {
      id: a.sub, username: a.username, name: a.name,
      role: a.role, roleName: user?.role.nameZh, perms: a.perms,
      locale: user?.locale ?? 'zh',
      mustChangePassword: user?.mustChangePassword ?? false,
      /** 空数组 = 可看全部楼栋 */
      buildings: (user?.buildings ?? []).map((b) => ({ id: b.building.id, code: b.building.code, name: b.building.name })),
      // 没有 space:all 又没分楼栋 = 什么都看不到（和 buildingScope 同一口径），不是「看全部」
      scopeAll: hasPermission(a.perms, 'space:all'),
      identities: (user?.identities ?? []).map((i) => ({ provider: i.provider, displayName: i.displayName })),
    };
  });

  app.post<{ Body: { oldPassword: string; newPassword: string } }>(
    '/api/auth/change-password',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { oldPassword, newPassword } = req.body ?? ({} as any);
      if (typeof newPassword !== 'string' || newPassword.length < 6)
        return reply.code(400).send({ error: '新密码至少 6 位' });
      const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
      if (!user) return reply.code(404).send({ error: '账号不存在' });
      // 首次登录强制改密时，旧密码仍需校验（初始密码由管理员告知）
      if (typeof oldPassword !== 'string' || !verifyPassword(oldPassword, user.passwordHash))
        return reply.code(400).send({ error: '原密码不正确' });
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashPassword(newPassword), mustChangePassword: false },
      });
      await audit(req, 'CHANGE_PASSWORD', { targetType: 'User', targetId: user.id });
      return { ok: true };
    }
  );

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req) => {
    await audit(req, 'LOGOUT');
    // 无状态 token，服务端不留会话；前端清掉本地 token 即可
    return { ok: true };
  });

  // ---------------------------------------------------------------- 账号管理
  app.get('/api/users', { preHandler: requirePerm('user:read') }, async () => {
    const users = await prisma.user.findMany({
      include: { role: true, buildings: { include: { building: true } }, identities: true },
      orderBy: { id: 'asc' },
    });
    return users.map((u) => ({
      id: u.id, username: u.username, name: u.name, phone: u.phone,
      role: u.role.nameZh, roleId: u.roleId, roleCode: u.role.code,
      isActive: u.isActive, lastLoginAt: u.lastLoginAt, locale: u.locale,
      hasPassword: !!u.passwordHash, mustChangePassword: u.mustChangePassword,
      buildings: u.buildings.map((b) => ({ id: b.building.id, code: b.building.code })),
      identities: u.identities.map((i) => ({ provider: i.provider, externalId: i.externalId })),
    }));
  });

  app.post<{ Body: Record<string, any> }>('/api/users', { preHandler: requirePerm('user:write') }, async (req, reply) => {
    const b = req.body;
    if (!b.username || !b.name || !b.roleId) return reply.code(400).send({ error: '账号、姓名、角色必填' });
    const exists = await prisma.user.findUnique({ where: { username: b.username } });
    if (exists) return reply.code(400).send({ error: '账号已存在' });
    if (!(await prisma.role.findUnique({ where: { id: Number(b.roleId) } }))) return reply.code(400).send({ error: '角色不存在' });
    const user = await prisma.user.create({
      data: {
        username: b.username, name: b.name, roleId: Number(b.roleId), phone: b.phone,
        locale: b.locale ?? 'zh',
        passwordHash: b.password ? hashPassword(b.password) : null,
        mustChangePassword: !!b.password,
      },
    });
    if (Array.isArray(b.buildingIds) && b.buildingIds.length) {
      await prisma.userBuilding.createMany({
        data: b.buildingIds.map((id: number) => ({ userId: user.id, buildingId: Number(id) })),
      });
    }
    await audit(req, 'USER_CREATE', { targetType: 'User', targetId: user.id, detail: b.username });
    return publicUser(user);
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/users/:id',
    { preHandler: requirePerm('user:write') },
    async (req, reply) => {
      const id = Number(req.params.id);
      const b = req.body ?? {};
      if (!(await prisma.user.findUnique({ where: { id } }))) return reply.code(404).send({ error: '账号不存在' });
      // 别把自己锁在门外：不能停用自己
      if (id === req.auth!.sub && b.isActive === false) return reply.code(400).send({ error: '不能停用当前登录的账号' });
      const data: any = {};
      for (const k of ['name', 'phone', 'isActive', 'locale']) if (k in b) data[k] = b[k];
      if (b.roleId) {
        if (!(await prisma.role.findUnique({ where: { id: Number(b.roleId) } }))) return reply.code(400).send({ error: '角色不存在' });
        data.roleId = Number(b.roleId);
      }
      if (b.password) { data.passwordHash = hashPassword(b.password); data.mustChangePassword = true; }
      const user = await prisma.user.update({ where: { id }, data });
      if (Array.isArray(b.buildingIds)) {
        await prisma.userBuilding.deleteMany({ where: { userId: id } });
        if (b.buildingIds.length) {
          await prisma.userBuilding.createMany({
            data: b.buildingIds.map((bid: number) => ({ userId: id, buildingId: Number(bid) })),
          });
        }
      }
      await audit(req, 'USER_UPDATE', { targetType: 'User', targetId: id, detail: b.password ? '重置密码' : undefined });
      return publicUser(user);
    }
  );

  // ---------------------------------------------------------------- 审计日志
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/audit-logs',
    { preHandler: requirePerm('audit:read') },
    async (req) => {
      const { page, pageSize } = paging(req.query, 30);
      const where: any = {};
      if (req.query.action) where.action = req.query.action;
      if (req.query.username) where.username = { contains: req.query.username };
      const [total, rows] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where, orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize, take: pageSize,
        }),
      ]);
      return { total, page, pageSize, rows };
    }
  );
}

/** 账号对象回给前端前去掉密码哈希 —— 哪怕是加盐的 scrypt，也不该离开服务端 */
function publicUser<T extends { passwordHash?: string | null }>(u: T) {
  const { passwordHash, ...rest } = u;
  return { ...rest, hasPassword: !!passwordHash };
}
