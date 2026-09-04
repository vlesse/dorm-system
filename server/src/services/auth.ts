import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

/**
 * 认证与授权。
 *
 * 有意不引第三方库：JWT 用 node:crypto 的 HMAC-SHA256 手写，密码用 scrypt。
 * 逻辑很短，行为完全可控，也少一层供应链风险。
 *
 * 两类身份：
 *   - 管理端账号 User  —— 宿管 / 主管 / HR / EHS，账号密码或企业平台扫码登录
 *   - 员工本人 Person —— 不发账号密码，只走企业平台身份或手机验证码（见 IdentityBinding）
 */

const SECRET = process.env.JWT_SECRET ?? 'dorm-system-dev-secret-change-in-production';
const TOKEN_TTL_SECONDS = 12 * 3600; // 宿管一个班次的长度

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s: string) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface TokenPayload {
  sub: number; // userId
  kind: 'USER' | 'PERSON';
  username: string;
  name: string;
  role: string;
  perms: string[];
  buildings: number[]; // 空数组 = 全部楼栋
  exp: number;
}

export function signToken(payload: Omit<TokenPayload, 'exp'>): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  // 定长比较，避免时序侧信道
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString()) as TokenPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ 密码
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(plain, salt, 64);
  const want = Buffer.from(hash, 'hex');
  if (calc.length !== want.length) return false;
  return crypto.timingSafeEqual(calc, want);
}

// ------------------------------------------------------------------ 权限
/**
 * 权限点写成 `模块:动作`，角色里存逗号分隔的列表。
 * `*` = 全部；`space:*` = space 模块全部；`space:read` = 精确匹配。
 */
export function hasPermission(perms: string[], needed: string): boolean {
  if (perms.includes('*')) return true;
  if (perms.includes(needed)) return true;
  const [mod] = needed.split(':');
  return perms.includes(`${mod}:*`);
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: TokenPayload;
  }
}

/** 从请求里解析当前用户，解析不出来就是匿名 */
export async function attachAuth(req: FastifyRequest) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;
  const payload = verifyToken(header.slice(7));
  if (payload) req.auth = payload;
}

/** 需要登录 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.auth) return reply.code(401).send({ error: '未登录或登录已过期', code: 'UNAUTHENTICATED' });
}

/** 需要某个权限点 */
export function requirePerm(perm: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) return reply.code(401).send({ error: '未登录或登录已过期', code: 'UNAUTHENTICATED' });
    if (req.auth.kind === 'PERSON') {
      return reply.code(403).send({ error: '员工自助账号不能访问管理端', code: 'NOT_STAFF' });
    }
    if (!hasPermission(req.auth.perms, perm)) {
      return reply.code(403).send({ error: `没有「${perm}」权限`, code: 'FORBIDDEN', needed: perm });
    }
  };
}

/**
 * 数据范围：楼栋宿管只看自己那几栋楼。
 * 返回 null 表示不限（看全部）。
 */
export function buildingScope(req: FastifyRequest): number[] | null {
  if (!req.auth) return null;
  if (hasPermission(req.auth.perms, 'space:all')) return null;
  return req.auth.buildings.length > 0 ? req.auth.buildings : null;
}

/** 把楼栋范围拼进 Prisma where —— 各表到 building 的路径不同，这里统一 */
export function scopedWhere(
  scope: number[] | null,
  path: 'building' | 'floor' | 'room' | 'bed' | 'occupancy'
): any {
  if (!scope) return {};
  switch (path) {
    case 'building': return { id: { in: scope } };
    case 'floor': return { buildingId: { in: scope } };
    case 'room': return { floor: { buildingId: { in: scope } } };
    case 'bed': return { room: { floor: { buildingId: { in: scope } } } };
    case 'occupancy': return { bed: { room: { floor: { buildingId: { in: scope } } } } };
  }
}

export const actor = (req: FastifyRequest) => req.auth?.name ?? req.auth?.username ?? 'system';

/** 审计留痕。有了登录之后，「谁干的」才是真的 */
export async function audit(
  req: FastifyRequest,
  action: string,
  opts: { targetType?: string; targetId?: number; detail?: string } = {}
) {
  await prisma.auditLog.create({
    data: {
      userId: req.auth?.kind === 'USER' ? req.auth.sub : null,
      username: actor(req),
      action,
      targetType: opts.targetType,
      targetId: opts.targetId,
      detail: opts.detail,
      ip: req.ip,
    },
  });
}

/** 登录成功后组装 token —— 角色权限和楼栋范围一起打进去，后续请求不用再查库 */
export async function issueTokenForUser(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true, buildings: true },
  });
  if (!user || !user.isActive) return null;
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  const perms = user.role.permissions.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    token: signToken({
      sub: user.id, kind: 'USER', username: user.username, name: user.name,
      role: user.role.code, perms, buildings: user.buildings.map((b) => b.buildingId),
    }),
    user: {
      id: user.id, username: user.username, name: user.name,
      role: user.role.code, roleName: user.role.nameZh, perms,
      buildings: user.buildings.map((b) => b.buildingId),
      locale: user.locale, mustChangePassword: user.mustChangePassword,
    },
  };
}

// ==================================================== 员工自助端
/**
 * 员工本人的 token。刻意和管理端账号分开：
 *   kind = 'PERSON'，sub = personId，权限固定只有 'self'。
 * 这样即使 token 泄漏也只能看自己那点数据，碰不到管理端接口。
 */
export async function issueTokenForPerson(personId: number) {
  const { prisma: db } = await import('../db.js');
  const person = await db.person.findUnique({ where: { id: personId } });
  if (!person || person.employmentStatus === 'RESIGNED') return null;
  return {
    token: signToken({
      sub: person.id, kind: 'PERSON',
      username: person.employeeNo, name: person.name,
      role: 'SELF', perms: ['self'], buildings: [],
    }),
    person: { id: person.id, employeeNo: person.employeeNo, name: person.name },
  };
}

/** 只允许员工本人 token 访问 */
export async function requireSelf(req: FastifyRequest, reply: FastifyReply) {
  if (!req.auth) return reply.code(401).send({ error: '未登录或登录已过期', code: 'UNAUTHENTICATED' });
  if (req.auth.kind !== 'PERSON') {
    return reply.code(403).send({ error: '该接口只面向员工本人', code: 'NOT_SELF' });
  }
}

/** 管理端接口不接受员工 token */
export async function requireStaff(req: FastifyRequest, reply: FastifyReply) {
  if (!req.auth) return reply.code(401).send({ error: '未登录或登录已过期', code: 'UNAUTHENTICATED' });
  if (req.auth.kind !== 'USER') {
    return reply.code(403).send({ error: '员工自助账号不能访问管理端', code: 'NOT_STAFF' });
  }
}
