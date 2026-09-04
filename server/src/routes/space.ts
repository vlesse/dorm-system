import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { ROOM_INCLUDE, serializeRoom } from '../services/space.js';
import { buildingScope, requirePerm, actor, audit } from '../services/auth.js';
import QRCode from 'qrcode';

const LIVE = ['ACTIVE', 'HELD', 'RESERVED'];

const countBeds = (beds: { status: string }[]) => ({
  total: beds.length,
  occupied: beds.filter((b) => b.status === 'OCCUPIED').length,
  held: beds.filter((b) => b.status === 'HELD').length,
  reserved: beds.filter((b) => b.status === 'RESERVED').length,
  free: beds.filter((b) => b.status === 'FREE').length,
  maintenance: beds.filter((b) => ['MAINTENANCE', 'LOCKED'].includes(b.status)).length,
  disabled: beds.filter((b) => b.status === 'DISABLED').length,
});

export default async function spaceRoutes(app: FastifyInstance) {
  /** 空间树：园区 → 楼栋 → 楼层（带床位与房间统计） */
  app.get('/api/space/tree', async (req) => {
    // 楼栋宿管只看得到自己那几栋楼
    const scope = buildingScope(req);
    const buildings = await prisma.building.findMany({
      where: { isActive: true, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { sortOrder: 'asc' },
      include: {
        nationality: true,
        floors: {
          orderBy: { level: 'asc' },
          include: {
            nationality: true,
            rooms: { include: { roomType: true, beds: { select: { id: true, status: true } } } },
          },
        },
      },
    });

    return buildings.map((b) => {
      const allRooms = b.floors.flatMap((f) => f.rooms);
      const allBeds = allRooms.flatMap((r) => r.beds);
      return {
        id: b.id, code: b.code, name: b.name,
        genderPolicy: b.genderPolicy,
        nationalityId: b.nationalityId,
        nationalityColor: b.nationality?.color ?? null,
        hasElevator: b.hasElevator,
        note: b.note,
        floorCount: b.floors.length,
        roomCount: allRooms.length,
        functionRoomCount: allRooms.filter((r) => !r.roomType.isResidential).length,
        deratedRoomCount: allRooms.filter((r) => r.deratedReason).length,
        approvedCapacity: allRooms.reduce((s, r) => s + r.capacity, 0),
        stats: countBeds(allBeds),
        floors: b.floors.map((f) => ({
          id: f.id, level: f.level, name: f.name,
          nationalityId: f.nationalityId,
          nationalityColor: f.nationality?.color ?? null,
          genderPolicy: f.genderPolicy,
          roomCount: f.rooms.length,
          functionRoomCount: f.rooms.filter((r) => !r.roomType.isResidential).length,
          approvedCapacity: f.rooms.reduce((s, r) => s + r.capacity, 0),
          stats: countBeds(f.rooms.flatMap((r) => r.beds)),
        })),
      };
    });
  });

  /** 楼层详情：该层所有房间 + 床位 + 住户 —— 床位图数据源 */
  app.get<{ Params: { id: string } }>('/api/space/floors/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const floor = await prisma.floor.findUnique({
      where: { id },
      include: {
        building: { include: { nationality: true } },
        nationality: true,
        rooms: { orderBy: { code: 'asc' }, include: ROOM_INCLUDE },
      },
    });
    if (!floor) return reply.code(404).send({ error: 'floor not found' });
    return {
      id: floor.id, level: floor.level, name: floor.name,
      nationalityId: floor.nationalityId, genderPolicy: floor.genderPolicy, note: floor.note,
      building: {
        id: floor.building.id, code: floor.building.code, name: floor.building.name,
        genderPolicy: floor.building.genderPolicy, nationalityId: floor.building.nationalityId,
        hasElevator: floor.building.hasElevator,
      },
      rooms: floor.rooms.map(serializeRoom),
    };
  });

  app.get<{ Params: { id: string } }>('/api/space/rooms/:id', async (req, reply) => {
    const room = await prisma.room.findUnique({
      where: { id: Number(req.params.id) },
      include: ROOM_INCLUDE,
    });
    if (!room) return reply.code(404).send({ error: 'room not found' });
    const workOrders = await prisma.workOrder.findMany({
      where: { scopeType: 'ROOM', scopeId: room.id },
      include: { category: true }, orderBy: { reportedAt: 'desc' }, take: 10,
    });
    return {
      ...serializeRoom(room),
      workOrders: workOrders.map((w) => ({
        id: w.id, code: w.code, title: w.title, category: w.category.nameZh,
        status: w.status, priority: w.priority, reportedAt: w.reportedAt,
      })),
    };
  });

  /** 修改楼层归属（国籍 / 性别策略） */
  app.put<{ Params: { id: string }; Body: { nationalityId?: string | null; genderPolicy?: string | null; note?: string | null } }>(
    '/api/space/floors/:id',
    { preHandler: requirePerm('space:write') },
    async (req) => {
      const { nationalityId, genderPolicy, note } = req.body;
      return prisma.floor.update({
        where: { id: Number(req.params.id) },
        data: {
          ...(nationalityId !== undefined ? { nationalityId: nationalityId || null } : {}),
          ...(genderPolicy !== undefined ? { genderPolicy: genderPolicy || null } : {}),
          ...(note !== undefined ? { note } : {}),
        },
      });
    }
  );

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/space/buildings/:id',
    { preHandler: requirePerm('space:write') },
    async (req) => {
    const b = req.body;
    return prisma.building.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(b.genderPolicy !== undefined ? { genderPolicy: b.genderPolicy } : {}),
        ...(b.nationalityId !== undefined ? { nationalityId: b.nationalityId || null } : {}),
        ...(b.hasElevator !== undefined ? { hasElevator: b.hasElevator } : {}),
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.note !== undefined ? { note: b.note } : {}),
      },
    });
  });

  /** 房间状态与属性维护 */
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/space/rooms/:id',
    { preHandler: requirePerm('space:room') },
    async (req, reply) => {
    const id = Number(req.params.id);
    const b = req.body;
    if (b.status && ['MAINTENANCE', 'LOCKED', 'QUARANTINE'].includes(b.status)) {
      const live = await prisma.occupancy.count({ where: { status: { in: LIVE }, bed: { roomId: id } } });
      if (live > 0) return reply.code(400).send({ error: `房间内仍有 ${live} 人未退宿，不能置为「${b.status}」` });
    }
    const data: any = {};
    for (const k of ['status', 'note', 'roomTypeId', 'genderPolicy', 'nationalityId',
      'hasAC', 'hasBathroom', 'hasWaterHeater', 'hasBalcony', 'orientation', 'area', 'name']) {
      if (k in b) data[k] = b[k];
    }
    return prisma.room.update({ where: { id }, data });
  });

  /**
   * 调整核定人数（降标 / 恢复）。
   * 「四人间实际住三人」就走这个接口：核定人数改成 3，多出来的空床自动标记为撤除。
   * 已经住人的床不会被动，会返回提示让宿管先调宿。
   */
  app.put<{ Params: { id: string }; Body: { capacity: number; deratedReason?: string | null; operator?: string } }>(
    '/api/space/rooms/:id/capacity',
    { preHandler: requirePerm('space:capacity') },
    async (req, reply) => {
      const id = Number(req.params.id);
      const { capacity, deratedReason } = req.body;
      const room = await prisma.room.findUnique({
        where: { id },
        include: { roomType: true, beds: { include: { occupancies: { where: { status: { in: LIVE } } } } } },
      });
      if (!room) return reply.code(404).send({ error: '房间不存在' });
      if (!room.roomType.isResidential) return reply.code(400).send({ error: '功能房不设核定人数' });
      if (capacity < 0 || capacity > room.roomType.defaultCapacity + 4)
        return reply.code(400).send({ error: `核定人数应在 0 ~ ${room.roomType.defaultCapacity + 4} 之间` });

      const occupied = room.beds.filter((b) => b.occupancies.length > 0);
      if (occupied.length > capacity)
        return reply.code(400).send({
          error: `该房间当前在住 ${occupied.length} 人，超过要设置的核定人数 ${capacity}，请先调宿`,
        });

      // 空床按顺序：前 capacity 个保留可用，其余标记撤除
      const ordered = [...room.beds].sort((a, b) => {
        const ao = a.occupancies.length > 0 ? 0 : 1;
        const bo = b.occupancies.length > 0 ? 0 : 1;
        return ao - bo || a.id - b.id;
      });
      await prisma.$transaction(async (tx) => {
        await tx.room.update({
          where: { id },
          data: {
            capacity,
            deratedReason: capacity < room.roomType.defaultCapacity ? (deratedReason ?? '按核定人数降标') : null,
          },
        });
        for (const [i, bed] of ordered.entries()) {
          if (bed.occupancies.length > 0) continue;
          const shouldDisable = i >= capacity;
          const target = shouldDisable ? 'DISABLED' : 'FREE';
          if (['MAINTENANCE', 'LOCKED'].includes(bed.status)) continue; // 报修中的床不动
          if (bed.status !== target) {
            await tx.bed.update({
              where: { id: bed.id },
              data: { status: target, note: shouldDisable ? '按核定人数降标撤除' : null },
            });
          }
        }
      });
      await audit(req, 'ROOM_CAPACITY', {
        targetType: 'Room', targetId: id,
        detail: '核定人数 ' + room.capacity + ' → ' + capacity,
      });
      const updated = await prisma.room.findUnique({ where: { id }, include: ROOM_INCLUDE });
      return serializeRoom(updated);
    }
  );

  /** 楼层平面：一屏看完这层每间房的类型、核定、在住 */
  app.get<{ Params: { id: string } }>('/api/space/floors/:id/summary', async (req) => {
    const rooms = await prisma.room.findMany({
      where: { floorId: Number(req.params.id) },
      include: { roomType: true, beds: { include: { occupancies: { where: { status: { in: LIVE } } } } } },
      orderBy: { code: 'asc' },
    });
    return rooms.map((r) => ({
      id: r.id, code: r.code, roomType: r.roomType.nameZh, roomTypeCode: r.roomType.code,
      isResidential: r.roomType.isResidential, isCoupleRoom: r.roomType.isCoupleRoom,
      nominal: r.roomType.defaultCapacity, capacity: r.capacity, deratedReason: r.deratedReason,
      occupants: r.beds.reduce((s, b) => s + b.occupancies.length, 0),
      usableBeds: r.beds.filter((b) => !['DISABLED', 'MAINTENANCE', 'LOCKED'].includes(b.status)).length,
      status: r.status,
    }));
  });

  /**
   * 房门二维码。贴在门上，员工扫了直接进自助端的该房间页面，一键报修。
   * selfBaseUrl 从设置里取（园区内网地址），没配就用请求来源。
   */
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/api/space/rooms/:id/qrcode',
    async (req, reply) => {
      const room = await prisma.room.findUnique({
        where: { id: Number(req.params.id) },
        include: { floor: { include: { building: true } }, roomType: true },
      });
      if (!room) return reply.code(404).send({ error: '房间不存在' });

      const setting = await prisma.settingItem.findUnique({ where: { key: 'self.baseUrl' } });
      let base = '';
      try { base = JSON.parse(setting?.value ?? '""'); } catch { base = ''; }
      // 没配就用请求来源（前端页面的 Origin），最后才退到 host —— 免得二维码指到 API 端口
      if (!base) base = (req.headers.origin as string) ?? (req.headers.referer as string)?.replace(/\/[^/]*$/, '') ?? '';
      if (!base) base = `http://${req.headers.host ?? 'localhost:5183'}`;
      const url = `${base.replace(/\/$/, '')}/m/room/${encodeURIComponent(room.code)}`;

      if (req.query.format === 'svg') {
        const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 240 });
        reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
        return svg;
      }
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
      return {
        roomId: room.id, roomCode: room.code,
        building: room.floor.building.code, floorLevel: room.floor.level,
        roomType: room.roomType.nameZh,
        url, dataUrl,
      };
    }
  );

  /** 整层楼的门牌二维码，批量打印用 */
  app.get<{ Params: { id: string } }>('/api/space/floors/:id/qrcodes', async (req) => {
    const rooms = await prisma.room.findMany({
      where: { floorId: Number(req.params.id) },
      include: { roomType: true, floor: { include: { building: true } } },
      orderBy: { code: 'asc' },
    });
    const setting = await prisma.settingItem.findUnique({ where: { key: 'self.baseUrl' } });
    let base = '';
    try { base = JSON.parse(setting?.value ?? '""'); } catch { base = ''; }
    if (!base) base = (req.headers.origin as string) ?? `http://${req.headers.host ?? 'localhost:5183'}`;
    return Promise.all(rooms.map(async (r) => {
      const url = `${base.replace(/\/$/, '')}/m/room/${encodeURIComponent(r.code)}`;
      return {
        roomId: r.id, roomCode: r.code, roomType: r.roomType.nameZh,
        building: r.floor.building.code, floorLevel: r.floor.level,
        isResidential: r.roomType.isResidential,
        url, dataUrl: await QRCode.toDataURL(url, { margin: 1, width: 200 }),
      };
    }));
  });
}
