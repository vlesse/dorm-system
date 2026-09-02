import Fastify from 'fastify';
import cors from '@fastify/cors';
import { prisma } from './db.js';
import spaceRoutes from './routes/space.js';
import personRoutes from './routes/persons.js';
import allocationRoutes from './routes/allocation.js';
import reportRoutes from './routes/reports.js';
import configRoutes from './routes/config.js';

const app = Fastify({ logger: { transport: undefined, level: 'warn' } });

await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

await app.register(configRoutes);
await app.register(spaceRoutes);
await app.register(personRoutes);
await app.register(allocationRoutes);
await app.register(reportRoutes);

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
