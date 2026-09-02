import type { FastifyInstance } from 'fastify';
import { prisma, loadRules } from '../db.js';
import { evaluateAssignment, splitChecks } from '../services/rules.js';
import { ROOM_INCLUDE, personToLike, roomToContext, serializeRoom } from '../services/space.js';

const LIVE = ['ACTIVE', 'HELD', 'RESERVED'];

const PERSON_INCLUDE = {
  nationality: true, department: true, positionLevel: true, shift: true, contractor: true,
};

async function currentOccupancy(personId: number) {
  return prisma.occupancy.findFirst({
    where: { personId, status: { in: LIVE } },
    include: { bed: { include: { room: { include: { floor: { include: { building: true } }, roomType: true } } } } },
  });
}

export default async function allocationRoutes(app: FastifyInstance) {
  /**
   * 推荐床位：给某个人算出所有可分配床位，按规则打分排序。
   * 硬约束不通过的房间直接排除；软约束不通过的会带着提醒返回，宿管自己判断。
   */
  app.get<{ Params: { personId: string }; Querystring: { buildingId?: string; limit?: string } }>(
    '/api/allocation/candidates/:personId',
    async (req, reply) => {
      const personId = Number(req.params.personId);
      const person = await prisma.person.findUnique({ where: { id: personId }, include: PERSON_INCLUDE });
      if (!person) return reply.code(404).send({ error: 'person not found' });

      const existing = await currentOccupancy(personId);
      const rules = await loadRules();
      const pl = personToLike(person);
      const limit = Number(req.query.limit ?? 30);

      const rooms = await prisma.room.findMany({
        where: {
          status: 'AVAILABLE',
          beds: { some: { status: 'FREE' } },
          ...(req.query.buildingId ? { floor: { buildingId: Number(req.query.buildingId) } } : {}),
        },
        include: ROOM_INCLUDE,
      });

      const results: any[] = [];
      for (const room of rooms) {
        const ctx = roomToContext(room);
        const checks = evaluateAssignment(pl, ctx, rules);
        const { blockers, warnings } = splitChecks(checks);
        if (blockers.length > 0) continue;
        const freeBeds = room.beds.filter((b: any) => b.status === 'FREE');
        if (freeBeds.length === 0) continue;

        let score = 100 - warnings.length * 12;
        if (ctx.nationalityId === person.nationalityId) score += 25;
        if (ctx.occupants.length > 0) score += 8;
        if (ctx.minPositionRank !== null) score += Math.min(ctx.minPositionRank, person.positionLevel.rank) / 2;

        results.push({
          score: Math.round(score),
          warnings: warnings.map((w) => ({ rule: w.rule, message: w.message })),
          room: serializeRoom(room),
          freeBedIds: freeBeds.map((b: any) => b.id),
        });
      }
      results.sort((a, b) => b.score - a.score);

      return {
        person: {
          id: person.id, employeeNo: person.employeeNo, name: person.name, gender: person.gender,
          nationalityId: person.nationalityId, department: person.department.nameZh,
          positionLevel: person.positionLevel.nameZh, positionRank: person.positionLevel.rank,
          shift: person.shift?.nameZh ?? null, contractor: person.contractor.name,
          employmentStatus: person.employmentStatus,
        },
        currentBed: existing ? { bedId: existing.bedId, bedCode: existing.bed.code, roomCode: existing.bed.room.code } : null,
        rules,
        candidates: results.slice(0, limit),
        totalMatched: results.length,
      };
    }
  );

  /** 试算：把某人放到某张床上会触发哪些提醒 / 拦截 */
  app.get<{ Querystring: { personId: string; bedId: string } }>('/api/allocation/check', async (req, reply) => {
    const person = await prisma.person.findUnique({ where: { id: Number(req.query.personId) }, include: PERSON_INCLUDE });
    const bed = await prisma.bed.findUnique({ where: { id: Number(req.query.bedId) }, include: { room: { include: ROOM_INCLUDE } } });
    if (!person || !bed) return reply.code(404).send({ error: 'not found' });
    const rules = await loadRules();
    const checks = evaluateAssignment(personToLike(person), roomToContext(bed.room), rules);
    return { ...splitChecks(checks), bedStatus: bed.status };
  });

  /** 分配 / 入住。force=true 时可越过软约束（硬约束永远拦） */
  app.post<{ Body: { personId: number; bedId: number; operator?: string; note?: string; force?: boolean; reserveOnly?: boolean } }>(
    '/api/allocation/assign',
    async (req, reply) => {
      const { personId, bedId, operator = 'admin', note, force = false, reserveOnly = false } = req.body;
      const person = await prisma.person.findUnique({ where: { id: personId }, include: PERSON_INCLUDE });
      if (!person) return reply.code(404).send({ error: '人员不存在' });
      if (person.employmentStatus === 'RESIGNED')
        return reply.code(400).send({ error: '该人员已离职，不能分配床位' });

      const existing = await currentOccupancy(personId);
      if (existing) return reply.code(400).send({ error: `该人员已有床位 ${existing.bed.code}，请使用「调宿」`, currentBedId: existing.bedId });

      const bed = await prisma.bed.findUnique({ where: { id: bedId }, include: { room: { include: ROOM_INCLUDE } } });
      if (!bed) return reply.code(404).send({ error: '床位不存在' });
      if (bed.status !== 'FREE') return reply.code(400).send({ error: `床位当前状态为「${bed.status}」，不可分配` });

      const rules = await loadRules();
      const checks = evaluateAssignment(personToLike(person), roomToContext(bed.room), rules);
      const { blockers, warnings } = splitChecks(checks);
      if (blockers.length > 0) return reply.code(400).send({ error: '不满足硬性排宿规则', blockers });
      if (warnings.length > 0 && !force) return reply.code(409).send({ error: '存在排宿提醒，确认后可继续', warnings });

      const result = await prisma.$transaction(async (tx) => {
        const occ = await tx.occupancy.create({
          data: {
            bedId, personId, status: reserveOnly ? 'RESERVED' : 'ACTIVE',
            assignedBy: operator, note,
          },
        });
        await tx.bed.update({ where: { id: bedId }, data: { status: reserveOnly ? 'RESERVED' : 'OCCUPIED' } });
        await tx.occupancyEvent.create({
          data: { type: reserveOnly ? 'ASSIGN' : 'CHECKIN', personId, bedId, operator, note },
        });
        return occ;
      });
      return { ok: true, occupancy: result, warnings };
    }
  );

  /** 调宿：结束旧记录 + 新建新记录，历史两条都留着 */
  app.post<{ Body: { personId: number; toBedId: number; operator?: string; reason?: string; force?: boolean } }>(
    '/api/allocation/transfer',
    async (req, reply) => {
      const { personId, toBedId, operator = 'admin', reason, force = false } = req.body;
      const person = await prisma.person.findUnique({ where: { id: personId }, include: PERSON_INCLUDE });
      if (!person) return reply.code(404).send({ error: '人员不存在' });
      const existing = await currentOccupancy(personId);
      if (!existing) return reply.code(400).send({ error: '该人员当前没有床位，请使用「分配」' });
      if (existing.bedId === toBedId) return reply.code(400).send({ error: '目标床位与当前床位相同' });

      const bed = await prisma.bed.findUnique({ where: { id: toBedId }, include: { room: { include: ROOM_INCLUDE } } });
      if (!bed) return reply.code(404).send({ error: '目标床位不存在' });
      if (bed.status !== 'FREE') return reply.code(400).send({ error: `目标床位状态为「${bed.status}」，不可分配` });

      const rules = await loadRules();
      const checks = evaluateAssignment(personToLike(person), roomToContext(bed.room), rules);
      const { blockers, warnings } = splitChecks(checks);
      if (blockers.length > 0) return reply.code(400).send({ error: '不满足硬性排宿规则', blockers });
      if (warnings.length > 0 && !force) return reply.code(409).send({ error: '存在排宿提醒，确认后可继续', warnings });

      const fromBedId = existing.bedId;
      const keepHeld = existing.status === 'HELD';
      const out = await prisma.$transaction(async (tx) => {
        await tx.occupancy.update({
          where: { id: existing.id },
          data: { status: 'ENDED', checkOutAt: new Date(), closedBy: operator, reason: reason ?? '调宿' },
        });
        await tx.bed.update({ where: { id: fromBedId }, data: { status: 'FREE' } });
        const occ = await tx.occupancy.create({
          data: { bedId: toBedId, personId, status: keepHeld ? 'HELD' : 'ACTIVE', assignedBy: operator, note: reason },
        });
        await tx.bed.update({ where: { id: toBedId }, data: { status: keepHeld ? 'HELD' : 'OCCUPIED' } });
        await tx.occupancyEvent.create({
          data: { type: 'TRANSFER', personId, bedId: toBedId, fromBedId, toBedId, operator, note: reason },
        });
        return occ;
      });
      return { ok: true, occupancy: out, warnings };
    }
  );

  /** 退宿 */
  app.post<{ Body: { personId: number; operator?: string; reason?: string } }>(
    '/api/allocation/checkout',
    async (req, reply) => {
      const { personId, operator = 'admin', reason } = req.body;
      const existing = await currentOccupancy(personId);
      if (!existing) return reply.code(400).send({ error: '该人员当前没有在住床位' });
      await prisma.$transaction(async (tx) => {
        await tx.occupancy.update({
          where: { id: existing.id },
          data: { status: 'ENDED', checkOutAt: new Date(), closedBy: operator, reason: reason ?? '退宿' },
        });
        await tx.bed.update({ where: { id: existing.bedId }, data: { status: 'FREE' } });
        await tx.occupancyEvent.create({
          data: { type: 'CHECKOUT', personId, bedId: existing.bedId, operator, note: reason },
        });
      });
      return { ok: true, freedBed: existing.bed.code };
    }
  );

  /** 休假保留床位 / 返岗恢复 */
  app.post<{ Body: { personId: number; operator?: string; note?: string } }>(
    '/api/allocation/hold',
    async (req, reply) => {
      const { personId, operator = 'admin', note } = req.body;
      const existing = await currentOccupancy(personId);
      if (!existing) return reply.code(400).send({ error: '该人员当前没有床位' });
      await prisma.$transaction(async (tx) => {
        await tx.occupancy.update({ where: { id: existing.id }, data: { status: 'HELD', note: note ?? '休假，床位保留' } });
        await tx.bed.update({ where: { id: existing.bedId }, data: { status: 'HELD' } });
        await tx.person.update({ where: { id: personId }, data: { employmentStatus: 'ON_LEAVE' } });
        await tx.occupancyEvent.create({ data: { type: 'HOLD', personId, bedId: existing.bedId, operator, note } });
      });
      return { ok: true };
    }
  );

  app.post<{ Body: { personId: number; operator?: string } }>('/api/allocation/resume', async (req, reply) => {
    const { personId, operator = 'admin' } = req.body;
    const existing = await currentOccupancy(personId);
    if (!existing) return reply.code(400).send({ error: '该人员当前没有保留床位' });
    await prisma.$transaction(async (tx) => {
      await tx.occupancy.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } });
      await tx.bed.update({ where: { id: existing.bedId }, data: { status: 'OCCUPIED' } });
      await tx.person.update({
        where: { id: personId },
        data: { employmentStatus: 'ACTIVE', cycleStartDate: new Date() },
      });
      await tx.occupancyEvent.create({ data: { type: 'RESUME', personId, bedId: existing.bedId, operator } });
    });
    return { ok: true };
  });
}
