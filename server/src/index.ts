import Fastify from 'fastify';
import cors from '@fastify/cors';
import { prisma } from './db.js';
import { attachAuth } from './services/auth.js';
import authRoutes from './routes/auth.js';
import spaceRoutes from './routes/space.js';
import personRoutes from './routes/persons.js';
import allocationRoutes from './routes/allocation.js';
import reportRoutes from './routes/reports.js';
import configRoutes from './routes/config.js';
import operationRoutes from './routes/operations.js';
import integrationRoutes from './routes/integrations.js';
import selfRoutes from './routes/self.js';

const app = Fastify({ logger: { transport: undefined, level: 'warn' } });

await app.register(cors, { origin: true });

/** 不需要登录就能访问的白名单 */
const PUBLIC_PATHS = [
  /^\/api\/health$/,
  /^\/api\/auth\/login$/, /^\/api\/auth\/methods$/, /^\/api\/auth\/sso\//,
  // 员工自助端登录：发验证码 / 验证码校验 / 企业平台扫码
  /^\/api\/self\/otp\//, /^\/api\/self\/sso\//,
];

app.addHook('onRequest', async (req, reply) => {
  await attachAuth(req);
  const url = req.url.split('?')[0];
  if (PUBLIC_PATHS.some((p) => p.test(url))) return;
  if (!url.startsWith('/api/')) return;
  if (!req.auth) {
    return reply.code(401).send({ error: '未登录或登录已过期', code: 'UNAUTHENTICATED' });
  }
  // 员工自助 token 只能访问 /api/self/*，管理端一律拒绝 —— 在入口一次堵死，
  // 不依赖每个路由自己记得加守卫
  if (req.auth.kind === 'PERSON' && !url.startsWith('/api/self/')) {
    return reply.code(403).send({ error: '员工自助账号不能访问管理端', code: 'NOT_STAFF' });
  }
});

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

await app.register(authRoutes);
await app.register(configRoutes);
await app.register(spaceRoutes);
await app.register(personRoutes);
await app.register(allocationRoutes);
await app.register(reportRoutes);
await app.register(operationRoutes);
await app.register(integrationRoutes);
await app.register(selfRoutes);

// 用独立的 API_PORT，避免被外部工具注入的 PORT 抢占前端端口
const port = Number(process.env.API_PORT ?? 3101);
try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`\n  宿舍管理系统 API  →  http://localhost:${port}/api/health\n`);
} catch (e) {
  console.error(e);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
