import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
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
    if (!username || !password) return reply.code(400).send({ error: '请输入账号和密码' });

    const user = await prisma.user.findUnique({ where: { username } });
    // 用户不存在和密码错误给同一个提示，避免account枚举
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      await prisma.auditLog.create({
        data: { username, action: 'LOGIN_FAILED', detail: '账号或密码错误', ip: req.ip },
      });
      return reply.code(401).send({ error: '账号或密码不正确' });
    }

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
      scopeAll: hasPermission(a.perms, 'space:all') || (user?.buildings.length ?? 0) === 0,
      identities: (user?.identities ?? []).map((i) => ({ provider: i.provider, displayName: i.displayName })),
    };
  });

  app.post<{ Body: { oldPassword: string; newPassword: string } }>(
    '/api/auth/change-password',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { oldPassword, newPassword } = req.body ?? ({} as any);
      if (!newPassword || newPassword.length < 6)
        return reply.code(400).send({ error: '新密码至少 6 位' });
      const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
      if (!user) return reply.code(404).send({ error: '账号不存在' });
      // 首次登录强制改密时，旧密码仍需校验（初始密码由管理员告知）
      if (!verifyPassword(oldPassword, user.passwordHash))
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
    return user;
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/users/:id',
    { preHandler: requirePerm('user:write') },
    async (req) => {
      const id = Number(req.params.id);
      const b = req.body;
      const data: any = {};
      for (const k of ['name', 'phone', 'isActive', 'locale']) if (k in b) data[k] = b[k];
      if (b.roleId) data.roleId = Number(b.roleId);
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
      return user;
    }
  );

  // ---------------------------------------------------------------- 审计日志
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/audit-logs',
    { preHandler: requirePerm('audit:read') },
    async (req) => {
      const page = Number(req.query.page ?? 1);
      const pageSize = Math.min(Number(req.query.pageSize ?? 30), 200);
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
