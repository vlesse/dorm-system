import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { DEFAULT_RULES, RULE_META } from '../services/rules.js';
import { requirePerm, audit } from '../services/auth.js';

/**
 * 配置接口。所有业务口径都在这里改，不用动代码：
 * 国籍 / 部门 / 职级（含休假周期、夫妻房资格）/ 班次 / 宗教 / 承包商 /
 * 房型（规格、门槛、管理模式）/ 物品 / 违规类型 / 报修类别 / 角色 / 排宿规则
 */
const DICTS = {
  nationalities: 'nationality',
  departments: 'department',
  positionLevels: 'positionLevel',
  shifts: 'shift',
  religions: 'religion',
  contractors: 'contractor',
  roomTypes: 'roomType',
  itemTypes: 'itemType',
  violationTypes: 'violationType',
  workOrderCategories: 'workOrderCategory',
  complaintTypes: 'complaintType',
  roles: 'role',
} as const;

export default async function configRoutes(app: FastifyInstance) {
  /** 前端启动时一次性拿全部字典 */
  app.get('/api/meta', async () => {
    const [
      nationalities, departments, positionLevels, shifts, religions, contractors,
      roomTypes, itemTypes, violationTypes, workOrderCategories, complaintTypes, roles, users, settings, site,
    ] = await Promise.all([
      prisma.nationality.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.department.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.positionLevel.findMany({ orderBy: { rank: 'asc' } }),
      prisma.shift.findMany({ orderBy: { id: 'asc' } }),
      prisma.religion.findMany({ orderBy: { id: 'asc' } }),
      prisma.contractor.findMany({ orderBy: { id: 'asc' } }),
      prisma.roomType.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.itemType.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.violationType.findMany({ orderBy: { id: 'asc' } }),
      prisma.workOrderCategory.findMany({ orderBy: { id: 'asc' } }),
      prisma.complaintType.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.role.findMany({ orderBy: { id: 'asc' } }),
      prisma.user.findMany({ include: { role: true, buildings: { include: { building: true } } } }),
      prisma.settingItem.findMany(),
      prisma.site.findFirst(),
    ]);
    const settingMap: Record<string, any> = {};
    for (const s of settings) {
      try { settingMap[s.key] = JSON.parse(s.value); } catch { settingMap[s.key] = s.value; }
    }
    return {
      site,
      nationalities, departments, positionLevels, shifts, religions, contractors,
      roomTypes, itemTypes, violationTypes, workOrderCategories, complaintTypes, roles,
      users: users.map((u) => ({
        id: u.id, username: u.username, name: u.name, role: u.role.nameZh, roleCode: u.role.code,
        buildings: u.buildings.map((b) => ({ id: b.building.id, code: b.building.code })),
      })),
      settings: settingMap,
      defaultRules: DEFAULT_RULES,
      ruleMeta: RULE_META,
      bedStatuses: ['FREE', 'RESERVED', 'OCCUPIED', 'HELD', 'MAINTENANCE', 'LOCKED', 'DISABLED'],
      roomStatuses: ['AVAILABLE', 'MAINTENANCE', 'QUARANTINE', 'LOCKED', 'CLEANING'],
      employmentStatuses: ['ACTIVE', 'ON_LEAVE', 'BUSINESS_TRIP', 'HOSPITALIZED', 'RESIGNED'],
      personTypes: ['EMPLOYEE', 'DEPENDENT', 'VISITOR', 'INTERN'],
      workOrderStatuses: ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CLOSED', 'REJECTED'],
      priorities: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
      severities: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      requestTypes: ['CHECKIN', 'TRANSFER', 'CHECKOUT', 'COUPLE_ROOM', 'VISITOR_OVERNIGHT', 'EXTRA_BED'],
      inspectionTypes: ['NIGHT_ROLL_CALL', 'HYGIENE', 'SAFETY'],
      relationshipTypes: ['SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'OTHER'],
      complaintStatuses: ['NEW', 'ACCEPTED', 'INVESTIGATING', 'SUBSTANTIATED', 'UNSUBSTANTIATED', 'DUPLICATE', 'WITHDRAWN', 'CLOSED'],
      complaintRoutes: ['WARDEN', 'MANAGER', 'EHS', 'HR'],
    };
  });

  for (const [path, model] of Object.entries(DICTS)) {
    const repo = () => (prisma as any)[model];

    app.get(`/api/config/${path}`, async () => repo().findMany());

    app.post<{ Body: Record<string, any> }>(`/api/config/${path}`,
      { preHandler: requirePerm('config:write') },
      async (req) => repo().create({ data: req.body })
    );

    app.put<{ Params: { id: string }; Body: Record<string, any> }>(
      `/api/config/${path}/:id`,
      { preHandler: requirePerm('config:write') },
      async (req) => {
        const id = model === 'nationality' ? req.params.id : Number(req.params.id);
        const { id: _drop, ...data } = req.body;
        return repo().update({ where: { id }, data });
      }
    );

    app.delete<{ Params: { id: string } }>(`/api/config/${path}/:id`,
      { preHandler: requirePerm('config:write') },
      async (req, reply) => {
      const id = model === 'nationality' ? req.params.id : Number(req.params.id);
      try {
        // 字典一律软删除，避免历史记录断链
        return await repo().update({ where: { id }, data: { isActive: false } });
      } catch (e: any) {
        return reply.code(400).send({ error: e.message });
      }
    });
  }

  /** 设置项读写（含排宿规则与各类阈值） */
  app.get('/api/config/settings', async () => prisma.settingItem.findMany({ orderBy: { key: 'asc' } }));

  app.put<{ Params: { key: string }; Body: { value: any } }>('/api/config/settings/:key',
    { preHandler: requirePerm('config:write') },
    async (req) => {
    const value = typeof req.body.value === 'string' ? req.body.value : JSON.stringify(req.body.value);
    await audit(req, 'CONFIG_CHANGE', { targetType: 'Setting', detail: req.params.key });
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

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/devices/:id',
    { preHandler: requirePerm('config:write') },
    async (req) => prisma.device.update({ where: { id: Number(req.params.id) }, data: req.body })
  );

  /** 房间固定资产 */
  app.get<{ Querystring: { roomId?: string; status?: string } }>('/api/assets', async (req) => {
    const where: any = {};
    if (req.query.roomId) where.roomId = Number(req.query.roomId);
    if (req.query.status) where.status = req.query.status;
    return prisma.asset.findMany({
      where, include: { room: { include: { floor: { include: { building: true } } } } },
      orderBy: { id: 'asc' }, take: 500,
    });
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/assets/:id',
    { preHandler: requirePerm('space:room') },
    async (req) => prisma.asset.update({ where: { id: Number(req.params.id) }, data: req.body })
  );
}
