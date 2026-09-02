import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { DEFAULT_RULES } from '../services/rules.js';

/**
 * 配置接口。所有业务口径都在这里改，不用动代码：
 * 国籍 / 部门 / 职级（含休假周期）/ 班次 / 承包商 / 房型 / 排宿规则。
 */
const DICTS = {
  nationalities: 'nationality',
  departments: 'department',
  positionLevels: 'positionLevel',
  shifts: 'shift',
  contractors: 'contractor',
  roomTypes: 'roomType',
} as const;

export default async function configRoutes(app: FastifyInstance) {
  /** 前端启动时一次性拿全部字典 */
  app.get('/api/meta', async () => {
    const [nationalities, departments, positionLevels, shifts, contractors, roomTypes, settings, site] =
      await Promise.all([
        prisma.nationality.findMany({ orderBy: { sortOrder: 'asc' } }),
        prisma.department.findMany({ orderBy: { sortOrder: 'asc' } }),
        prisma.positionLevel.findMany({ orderBy: { rank: 'asc' } }),
        prisma.shift.findMany({ orderBy: { id: 'asc' } }),
        prisma.contractor.findMany({ orderBy: { id: 'asc' } }),
        prisma.roomType.findMany({ orderBy: { sortOrder: 'asc' } }),
        prisma.settingItem.findMany(),
        prisma.site.findFirst(),
      ]);
    const settingMap: Record<string, any> = {};
    for (const s of settings) {
      try { settingMap[s.key] = JSON.parse(s.value); } catch { settingMap[s.key] = s.value; }
    }
    return {
      site, nationalities, departments, positionLevels, shifts, contractors, roomTypes,
      settings: settingMap,
      defaultRules: DEFAULT_RULES,
      bedStatuses: ['FREE', 'RESERVED', 'OCCUPIED', 'HELD', 'MAINTENANCE', 'LOCKED'],
      roomStatuses: ['AVAILABLE', 'MAINTENANCE', 'QUARANTINE', 'LOCKED', 'CLEANING'],
      employmentStatuses: ['ACTIVE', 'ON_LEAVE', 'RESIGNED'],
    };
  });

  for (const [path, model] of Object.entries(DICTS)) {
    const repo = () => (prisma as any)[model];

    app.get(`/api/config/${path}`, async () => repo().findMany());

    app.post<{ Body: Record<string, any> }>(`/api/config/${path}`, async (req) =>
      repo().create({ data: req.body })
    );

    app.put<{ Params: { id: string }; Body: Record<string, any> }>(
      `/api/config/${path}/:id`,
      async (req) => {
        const id = model === 'nationality' ? req.params.id : Number(req.params.id);
        const { id: _drop, ...data } = req.body;
        return repo().update({ where: { id }, data });
      }
    );

    app.delete<{ Params: { id: string } }>(`/api/config/${path}/:id`, async (req, reply) => {
      const id = model === 'nationality' ? req.params.id : Number(req.params.id);
      try {
        // 字典一律软删除，避免历史记录断链
        return await repo().update({ where: { id }, data: { isActive: false } });
      } catch (e: any) {
        return reply.code(400).send({ error: e.message });
      }
    });
  }

  /** 设置项读写（含排宿规则） */
  app.get('/api/config/settings', async () => prisma.settingItem.findMany({ orderBy: { key: 'asc' } }));

  app.put<{ Params: { key: string }; Body: { value: any } }>('/api/config/settings/:key', async (req) => {
    const value = typeof req.body.value === 'string' ? req.body.value : JSON.stringify(req.body.value);
    return prisma.settingItem.upsert({
      where: { key: req.params.key },
      update: { value },
      create: { key: req.params.key, value },
    });
  });

  /** 设备列表（一期只读；摄像头点位已登记，二期接视频网关后启用） */
  app.get<{ Querystring: { scopeType?: string; scopeId?: string; type?: string } }>(
    '/api/devices',
    async (req) => {
      const where: any = {};
      if (req.query.scopeType) where.scopeType = req.query.scopeType;
      if (req.query.scopeId) where.scopeId = Number(req.query.scopeId);
      if (req.query.type) where.type = req.query.type;
      return prisma.device.findMany({ where, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
    }
  );

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/devices/:id', async (req) =>
    prisma.device.update({ where: { id: Number(req.params.id) }, data: req.body })
  );
}
