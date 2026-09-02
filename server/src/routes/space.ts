import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { ROOM_INCLUDE, serializeRoom } from '../services/space.js';

const LIVE = ['ACTIVE', 'HELD', 'RESERVED'];

export default async function spaceRoutes(app: FastifyInstance) {
  /** 空间树：园区 → 楼栋 → 楼层（带床位统计） */
  app.get('/api/space/tree', async () => {
    const buildings = await prisma.building.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        nationality: true,
        floors: {
          orderBy: { level: 'asc' },
          include: {
            nationality: true,
            rooms: { include: { beds: { select: { id: true, status: true } } } },
          },
        },
      },
    });

    const count = (beds: { status: string }[]) => ({
      total: beds.length,
      occupied: beds.filter((b) => b.status === 'OCCUPIED').length,
      held: beds.filter((b) => b.status === 'HELD').length,
      reserved: beds.filter((b) => b.status === 'RESERVED').length,
      free: beds.filter((b) => b.status === 'FREE').length,
      maintenance: beds.filter((b) => ['MAINTENANCE', 'LOCKED'].includes(b.status)).length,
    });

    return buildings.map((b) => {
      const allBeds = b.floors.flatMap((f) => f.rooms.flatMap((r) => r.beds));
      return {
        id: b.id, code: b.code, name: b.name,
        genderPolicy: b.genderPolicy,
        nationalityId: b.nationalityId,
        nationalityColor: b.nationality?.color ?? null,
        note: b.note,
        floorCount: b.floors.length,
        stats: count(allBeds),
        floors: b.floors.map((f) => ({
          id: f.id, level: f.level, name: f.name,
          nationalityId: f.nationalityId,
          nationalityColor: f.nationality?.color ?? null,
          genderPolicy: f.genderPolicy,
          roomCount: f.rooms.length,
          stats: count(f.rooms.flatMap((r) => r.beds)),
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
    return serializeRoom(room);
  });

  /** 修改楼层归属（国籍 / 性别策略）—— 你说的「不要写死」就靠这个接口 */
  app.put<{ Params: { id: string }; Body: { nationalityId?: string | null; genderPolicy?: string | null; note?: string | null } }>(
    '/api/space/floors/:id',
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

  app.put<{ Params: { id: string }; Body: { genderPolicy?: string; nationalityId?: string | null; name?: string; note?: string | null } }>(
    '/api/space/buildings/:id',
    async (req) => {
      const { genderPolicy, nationalityId, name, note } = req.body;
      return prisma.building.update({
        where: { id: Number(req.params.id) },
        data: {
          ...(genderPolicy !== undefined ? { genderPolicy } : {}),
          ...(nationalityId !== undefined ? { nationalityId: nationalityId || null } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(note !== undefined ? { note } : {}),
        },
      });
    }
  );

  /** 房间状态切换：维修 / 隔离 / 封锁 / 可用 */
  app.put<{ Params: { id: string }; Body: { status?: string; note?: string | null; roomTypeId?: number; capacity?: number } }>(
    '/api/space/rooms/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      const { status, note, roomTypeId, capacity } = req.body;
      if (status && status !== 'AVAILABLE') {
        const live = await prisma.occupancy.count({
          where: { status: { in: LIVE }, bed: { roomId: id } },
        });
        if (live > 0 && ['MAINTENANCE', 'LOCKED'].includes(status)) {
          return reply.code(400).send({ error: `房间内仍有 ${live} 人未退宿，不能置为「${status}」` });
        }
      }
      return prisma.room.update({
        where: { id },
        data: {
          ...(status !== undefined ? { status } : {}),
          ...(note !== undefined ? { note } : {}),
          ...(roomTypeId !== undefined ? { roomTypeId } : {}),
          ...(capacity !== undefined ? { capacity } : {}),
        },
      });
    }
  );
}
