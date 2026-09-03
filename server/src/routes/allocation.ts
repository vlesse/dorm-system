import type { FastifyInstance } from 'fastify';
import { prisma, loadRules } from '../db.js';
import { evaluateAssignment, splitChecks, scoreAssignment } from '../services/rules.js';
import {
  ROOM_INCLUDE, PERSON_INCLUDE, personToLike, roomToContext, serializeRoom, spouseIdsOf,
} from '../services/space.js';

const LIVE = ['ACTIVE', 'HELD', 'RESERVED'];

async function currentOccupancy(personId: number) {
  return prisma.occupancy.findFirst({
    where: { personId, status: { in: LIVE } },
    include: { bed: { include: { room: { include: { floor: { include: { building: true } }, roomType: true } } } } },
  });
}

export default async function allocationRoutes(app: FastifyInstance) {
  /**
   * 推荐床位：给某个人算出所有可分配床位，按规则打分排序。
   * 硬约束不通过的直接排除；软约束不通过的带着提醒返回，宿管自己判断。
   * 会逐张床评估（上下铺、夫妻房铺位都要单独判断）。
   */
  app.get<{ Params: { personId: string }; Querystring: { buildingId?: string; roomTypeId?: string; limit?: string } }>(
    '/api/allocation/candidates/:personId',
    async (req, reply) => {
      const personId = Number(req.params.personId);
      const person = await prisma.person.findUnique({ where: { id: personId }, include: PERSON_INCLUDE });
      if (!person) return reply.code(404).send({ error: 'person not found' });

      const existing = await currentOccupancy(personId);
      const rules = await loadRules();
      const spouseIds = await spouseIdsOf(personId);
      const pl = personToLike(person, spouseIds);
      const limit = Number(req.query.limit ?? 40);

      const rooms = await prisma.room.findMany({
        where: {
          status: 'AVAILABLE',
          roomType: { isResidential: true },
          beds: { some: { status: 'FREE' } },
          ...(req.query.buildingId ? { floor: { buildingId: Number(req.query.buildingId) } } : {}),
          ...(req.query.roomTypeId ? { roomTypeId: Number(req.query.roomTypeId) } : {}),
        },
        include: ROOM_INCLUDE,
      });

      const results: any[] = [];
      for (const room of rooms) {
        const freeBeds = room.beds.filter((b: any) => b.status === 'FREE');
        if (freeBeds.length === 0) continue;

        // 逐张空床评估，取该房间里最好的一张
        let bestBed: any = null;
        let bestWarnings: any[] = [];
        for (const bed of freeBeds) {
          const checks = evaluateAssignment(pl, roomToContext(room, bed), rules);
          const { blockers, warnings } = splitChecks(checks);
          if (blockers.length > 0) continue;
          if (!bestBed || warnings.length < bestWarnings.length) {
            bestBed = bed; bestWarnings = warnings;
          }
        }
        if (!bestBed) continue;

        const ctx = roomToContext(room);
        const score = scoreAssignment(pl, ctx, bestWarnings.length, bestBed.position);

        results.push({
          score: Math.round(score),
          warnings: bestWarnings.map((w) => ({ rule: w.rule, message: w.message })),
          room: serializeRoom(room),
          suggestedBedId: bestBed.id,
          suggestedBedLabel: bestBed.label,
          freeBedIds: freeBeds.map((b: any) => b.id),
        });
      }
      results.sort((a, b) => b.score - a.score);

      return {
        person: {
          id: person.id, employeeNo: person.employeeNo, name: person.name, gender: person.gender,
          personType: person.personType,
          nationalityId: person.nationalityId, department: person.department?.nameZh ?? null,
          positionLevel: person.positionLevel?.nameZh ?? null, positionRank: person.positionLevel?.rank ?? 0,
          shift: person.shift?.nameZh ?? null, contractor: person.contractor?.name ?? null,
          religion: person.religion?.nameZh ?? null,
          needsLowerBunk: person.needsLowerBunk, needsGroundFloor: person.needsGroundFloor,
          isSmoker: person.isSmoker,
          employmentStatus: person.employmentStatus,
          spouseIds, hostPersonId: person.hostPersonId,
          coupleRoomAllowed: person.positionLevel?.coupleRoomAllowed ?? false,
        },
        currentBed: existing
          ? { bedId: existing.bedId, bedCode: existing.bed.code, bedLabel: existing.bed.label, roomCode: existing.bed.room.code }
          : null,
        rules,
        candidates: results.slice(0, limit),
        totalMatched: results.length,
      };
    }
  );

  /** 试算：把某人放到某张床上会触发哪些提醒 / 拦截 */
  app.get<{ Querystring: { personId: string; bedId: string } }>('/api/allocation/check', async (req, reply) => {
    const person = await prisma.person.findUnique({ where: { id: Number(req.query.personId) }, include: PERSON_INCLUDE });
    const bed = await prisma.bed.findUnique({
      where: { id: Number(req.query.bedId) },
      include: { room: { include: ROOM_INCLUDE } },
    });
    if (!person || !bed) return reply.code(404).send({ error: 'not found' });
    const rules = await loadRules();
    const spouseIds = await spouseIdsOf(person.id);
    const checks = evaluateAssignment(personToLike(person, spouseIds), roomToContext(bed.room, bed), rules);
    return { ...splitChecks(checks), bedStatus: bed.status };
  });

  /** 分配 / 入住。force=true 可越过软约束（硬约束永远拦） */
  app.post<{ Body: { personId: number; bedId: number; operator?: string; note?: string; force?: boolean; reserveOnly?: boolean } }>(
    '/api/allocation/assign',
    async (req, reply) => {
      const { personId, bedId, operator = 'admin', note, force = false, reserveOnly = false } = req.body;
      const person = await prisma.person.findUnique({ where: { id: personId }, include: PERSON_INCLUDE });
      if (!person) return reply.code(404).send({ error: '人员不存在' });
      if (person.employmentStatus === 'RESIGNED')
        return reply.code(400).send({ error: '该人员已离职，不能分配床位' });

      const existing = await currentOccupancy(personId);
      if (existing)
        return reply.code(400).send({ error: `该人员已有床位 ${existing.bed.code}，请使用「调宿」`, currentBedId: existing.bedId });

      const bed = await prisma.bed.findUnique({ where: { id: bedId }, include: { room: { include: ROOM_INCLUDE } } });
      if (!bed) return reply.code(404).send({ error: '床位不存在' });

      const rules = await loadRules();
      const spouseIds = await spouseIdsOf(personId);
      const checks = evaluateAssignment(personToLike(person, spouseIds), roomToContext(bed.room, bed), rules);
      const { blockers, warnings } = splitChecks(checks);
      if (blockers.length > 0) return reply.code(400).send({ error: '不满足硬性排宿规则', blockers });
      if (warnings.length > 0 && !force) return reply.code(409).send({ error: '存在排宿提醒，确认后可继续', warnings });

      const result = await prisma.$transaction(async (tx) => {
        const occ = await tx.occupancy.create({
          data: { bedId, personId, status: reserveOnly ? 'RESERVED' : 'ACTIVE', assignedBy: operator, note },
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

      const rules = await loadRules();
      const spouseIds = await spouseIdsOf(personId);
      const checks = evaluateAssignment(personToLike(person, spouseIds), roomToContext(bed.room, bed), rules);
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

  /**
   * 退宿。默认会检查物品是否已归还 —— 人走了物品没清点是常见漏洞。
   * settleItems=true 表示已当场清点完毕，一并结清。
   */
  app.post<{ Body: { personId: number; operator?: string; reason?: string; settleItems?: boolean; force?: boolean } }>(
    '/api/allocation/checkout',
    async (req, reply) => {
      const { personId, operator = 'admin', reason, settleItems = false, force = false } = req.body;
      const existing = await currentOccupancy(personId);
      if (!existing) return reply.code(400).send({ error: '该人员当前没有在住床位' });

      const pending = await prisma.issuedItem.findMany({
        where: { personId, returnedAt: null },
        include: { itemType: true },
      });
      if (pending.length > 0 && !settleItems && !force) {
        return reply.code(409).send({
          error: '该人员还有未归还物品，请先清点',
          pendingItems: pending.map((i) => ({
            id: i.id, name: i.itemType.nameZh, quantity: i.quantity,
            price: i.itemType.price, deposit: i.itemType.deposit,
          })),
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.occupancy.update({
          where: { id: existing.id },
          data: { status: 'ENDED', checkOutAt: new Date(), closedBy: operator, reason: reason ?? '退宿' },
        });
        await tx.bed.update({ where: { id: existing.bedId }, data: { status: 'FREE' } });
        if (settleItems && pending.length > 0) {
          await tx.issuedItem.updateMany({
            where: { personId, returnedAt: null },
            data: { returnedAt: new Date(), returnedBy: operator, condition: 'GOOD' },
          });
        }
        await tx.deposit.updateMany({
          where: { personId, refundedAt: null },
          data: { refundedAt: new Date(), note: '退宿退还' },
        });
        await tx.occupancyEvent.create({
          data: { type: 'CHECKOUT', personId, bedId: existing.bedId, operator, note: reason },
        });
      });
      return { ok: true, freedBed: existing.bed.code, settledItems: settleItems ? pending.length : 0 };
    }
  );

  /** 休假保留床位 / 返岗恢复 */
  app.post<{ Body: { personId: number; operator?: string; note?: string } }>('/api/allocation/hold', async (req, reply) => {
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
  });

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

  /**
   * 夫妻房一次安排两个人 —— 实际操作里宿管不会分两次做。
   * 会校验：房型是夫妻房、两人已登记且已核验配偶关系、房间是空的。
   */
  app.post<{ Body: { personIdA: number; personIdB: number; roomId: number; operator?: string; force?: boolean } }>(
    '/api/allocation/assign-couple',
    async (req, reply) => {
      const { personIdA, personIdB, roomId, operator = 'admin', force = false } = req.body;
      const room = await prisma.room.findUnique({ where: { id: roomId }, include: ROOM_INCLUDE });
      if (!room) return reply.code(404).send({ error: '房间不存在' });
      if (!room.roomType.isCoupleRoom) return reply.code(400).send({ error: '该房间不是夫妻房 / 家庭房' });

      const [a, b] = await Promise.all([
        prisma.person.findUnique({ where: { id: personIdA }, include: PERSON_INCLUDE }),
        prisma.person.findUnique({ where: { id: personIdB }, include: PERSON_INCLUDE }),
      ]);
      if (!a || !b) return reply.code(404).send({ error: '人员不存在' });

      const spouseA = await spouseIdsOf(personIdA);
      if (!spouseA.includes(personIdB))
        return reply.code(400).send({ error: '两人之间没有已核验的配偶关系，不能安排夫妻房' });

      for (const p of [a, b]) {
        const cur = await currentOccupancy(p.id);
        if (cur) return reply.code(400).send({ error: `${p.name} 当前已住 ${cur.bed.code}，请先退宿或改用调宿` });
      }

      const freeBeds = room.beds.filter((x: any) => x.status === 'FREE');
      if (freeBeds.length < 2) return reply.code(400).send({ error: '该房间可用铺位不足两个' });

      const rules = await loadRules();
      const allWarnings: any[] = [];
      for (const [p, bed, sp] of [[a, freeBeds[0], spouseA], [b, freeBeds[1], [personIdA]]] as const) {
        const checks = evaluateAssignment(personToLike(p, sp as number[]), roomToContext(room, bed), rules);
        const { blockers, warnings } = splitChecks(checks);
        if (blockers.length > 0) return reply.code(400).send({ error: `${p.name} 不满足硬性规则`, blockers });
        allWarnings.push(...warnings);
      }
      if (allWarnings.length > 0 && !force)
        return reply.code(409).send({ error: '存在排宿提醒，确认后可继续', warnings: allWarnings });

      await prisma.$transaction(async (tx) => {
        for (const [p, bed] of [[a, freeBeds[0]], [b, freeBeds[1]]] as const) {
          await tx.occupancy.create({
            data: { bedId: bed.id, personId: p.id, status: 'ACTIVE', assignedBy: operator, note: '夫妻房整体安排' },
          });
          await tx.bed.update({ where: { id: bed.id }, data: { status: 'OCCUPIED' } });
          await tx.occupancyEvent.create({
            data: { type: 'CHECKIN', personId: p.id, bedId: bed.id, operator, note: '夫妻房整体安排' },
          });
        }
      });
      return { ok: true, roomCode: room.code, warnings: allWarnings };
    }
  );

  /** 加床（临时应急）。加床不计入核定人数，会单独标记 */
  app.post<{ Body: { roomId: number; label?: string; operator?: string; reason?: string } }>(
    '/api/allocation/extra-bed',
    async (req, reply) => {
      const { roomId, label, operator = 'admin', reason } = req.body;
      const room = await prisma.room.findUnique({ where: { id: roomId }, include: { beds: true, roomType: true } });
      if (!room) return reply.code(404).send({ error: '房间不存在' });
      if (!room.roomType.isResidential) return reply.code(400).send({ error: '功能房不能加床' });
      const n = room.beds.length + 1;
      const bed = await prisma.bed.create({
        data: {
          roomId, code: `${room.code}-X${n}`, label: label ?? `加床 ${n}`,
          position: 'SINGLE', status: 'FREE', isExtra: true,
          note: reason ?? '临时加床',
        },
      });
      await prisma.occupancyEvent.create({ data: { type: 'EXTRA_BED', bedId: bed.id, operator, note: reason } });
      return { ok: true, bed };
    }
  );

  /** 床位状态直接调整：撤除（降标）/ 报修 / 恢复 */
  app.put<{ Params: { id: string }; Body: { status: string; note?: string } }>(
    '/api/beds/:id/status',
    async (req, reply) => {
      const id = Number(req.params.id);
      const bed = await prisma.bed.findUnique({ where: { id }, include: { occupancies: { where: { status: { in: LIVE } } } } });
      if (!bed) return reply.code(404).send({ error: '床位不存在' });
      if (bed.occupancies.length > 0 && req.body.status !== 'OCCUPIED')
        return reply.code(400).send({ error: '该床位仍有在住人员，请先退宿或调宿' });
      return prisma.bed.update({ where: { id }, data: { status: req.body.status, note: req.body.note ?? null } });
    }
  );
}
