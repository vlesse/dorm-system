import type { FastifyInstance } from 'fastify';
import { prisma, loadRules } from '../db.js';
import { evaluateAssignment, splitChecks, scoreAssignment } from '../services/rules.js';
import {
  ROOM_INCLUDE, PERSON_INCLUDE, personToLike, roomToContext, serializeRoom, spouseIdsOf,
} from '../services/space.js';
import { requirePerm, actor, audit, buildingScope, bedInScope, roomInScope } from '../services/auth.js';

const NOT_IN_SCOPE = { error: '床位 / 房间不存在或不在你的管辖范围内' };

/**
 * 在事务里「抢」一张空床：只有状态还是 FREE 才改得动。
 * 先查后写的话，两个宿管同时给同一张床排人，两次检查都会看到 FREE，结果一床两人。
 */
async function claimBed(tx: any, bedId: number, status: string) {
  const r = await tx.bed.updateMany({ where: { id: bedId, status: 'FREE' }, data: { status } });
  if (r.count === 0) throw new BedTaken();
}
class BedTaken extends Error { constructor() { super('这张床刚被别人占用了，请刷新后重选'); } }
import { notify } from '../services/notify.js';

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
          AND: [
            req.query.buildingId ? { floor: { buildingId: Number(req.query.buildingId) } } : {},
            // 楼栋宿管只能往自己的楼里排
            ...(buildingScope(req) ? [{ floor: { buildingId: { in: buildingScope(req)! } } }] : []),
          ],
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
    { preHandler: requirePerm('allocation:write') },
    async (req, reply) => {
      const personId = Number(req.body?.personId), bedId = Number(req.body?.bedId);
      const { note, force = false, reserveOnly = false } = req.body ?? ({} as any);
      const operator = actor(req);
      if (!(await bedInScope(req, bedId))) return reply.code(404).send(NOT_IN_SCOPE);
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

      let result: any;
      try {
        result = await prisma.$transaction(async (tx) => {
        await claimBed(tx, bedId, reserveOnly ? 'RESERVED' : 'OCCUPIED');
        const occ = await tx.occupancy.create({
          data: { bedId, personId, status: reserveOnly ? 'RESERVED' : 'ACTIVE', assignedBy: operator, note },
        });
        await tx.occupancyEvent.create({
          data: { type: reserveOnly ? 'ASSIGN' : 'CHECKIN', personId, bedId, operator, note },
        });
        return occ;
        });
      } catch (e) {
        if (e instanceof BedTaken) return reply.code(409).send({ error: e.message });
        throw e;
      }
      await audit(req, 'ASSIGN', { targetType: 'Person', targetId: personId, detail: bed.code });
      await notify('BED_ASSIGNED', { personId }, {
        name: person.name, room: bed.room.code, bed: bed.label,
      }, { type: 'OCCUPANCY', id: result.id, linkPath: '/beds' });
      return { ok: true, occupancy: result, warnings };
    }
  );

  /** 调宿：结束旧记录 + 新建新记录，历史两条都留着 */
  app.post<{ Body: { personId: number; toBedId: number; operator?: string; reason?: string; force?: boolean } }>(
    '/api/allocation/transfer',
    { preHandler: requirePerm('allocation:write') },
    async (req, reply) => {
      const personId = Number(req.body?.personId), toBedId = Number(req.body?.toBedId);
      const { reason, force = false } = req.body ?? ({} as any);
      const operator = actor(req);
      if (!(await bedInScope(req, toBedId))) return reply.code(404).send(NOT_IN_SCOPE);
      const person = await prisma.person.findUnique({ where: { id: personId }, include: PERSON_INCLUDE });
      if (!person) return reply.code(404).send({ error: '人员不存在' });
      const existing = await currentOccupancy(personId);
      if (!existing) return reply.code(400).send({ error: '该人员当前没有床位，请使用「分配」' });
      if (existing.bedId === toBedId) return reply.code(400).send({ error: '目标床位与当前床位相同' });
      if (!(await bedInScope(req, existing.bedId))) return reply.code(404).send({ error: '该人员当前住在你管辖范围以外的楼栋' });

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
      let out: any;
      try {
        out = await prisma.$transaction(async (tx) => {
        await claimBed(tx, toBedId, keepHeld ? 'HELD' : 'OCCUPIED');
        await tx.occupancy.update({
          where: { id: existing.id },
          data: { status: 'ENDED', checkOutAt: new Date(), closedBy: operator, reason: reason ?? '调宿' },
        });
        await tx.bed.update({ where: { id: fromBedId }, data: { status: 'FREE' } });
        const occ = await tx.occupancy.create({
          data: { bedId: toBedId, personId, status: keepHeld ? 'HELD' : 'ACTIVE', assignedBy: operator, note: reason },
        });
        await tx.occupancyEvent.create({
          data: { type: 'TRANSFER', personId, bedId: toBedId, fromBedId, toBedId, operator, note: reason },
        });
        return occ;
        });
      } catch (e) {
        if (e instanceof BedTaken) return reply.code(409).send({ error: e.message });
        throw e;
      }
      await audit(req, 'TRANSFER', {
        targetType: 'Person', targetId: personId,
        detail: `${existing.bed.code} → ${bed.code}`,
      });
      await notify('TRANSFER_DONE', { personId }, {
        name: person.name, from: existing.bed.room.code, to: bed.room.code,
      }, { type: 'OCCUPANCY', id: out.id, linkPath: '/beds' });
      return { ok: true, occupancy: out, warnings };
    }
  );

  /**
   * 退宿。默认会检查物品是否已归还 —— 人走了物品没清点是常见漏洞。
   * settleItems=true 表示已当场清点完毕，一并结清。
   */
  app.post<{ Body: { personId: number; operator?: string; reason?: string; settleItems?: boolean; force?: boolean } }>(
    '/api/allocation/checkout',
    { preHandler: requirePerm('allocation:write') },
    async (req, reply) => {
      const personId = Number(req.body?.personId);
      const { reason, settleItems = false, force = false } = req.body ?? ({} as any);
      const operator = actor(req);
      const existing = await currentOccupancy(personId);
      if (!existing) return reply.code(400).send({ error: '该人员当前没有在住床位' });
      if (!(await bedInScope(req, existing.bedId))) return reply.code(404).send(NOT_IN_SCOPE);

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
      await audit(req, 'CHECKOUT', {
        targetType: 'Person', targetId: personId, detail: `${existing.bed.code} ${reason ?? ''}`,
      });
      return { ok: true, freedBed: existing.bed.code, settledItems: settleItems ? pending.length : 0 };
    }
  );

  /** 休假保留床位 / 返岗恢复 */
  // 以前 hold / resume / extra-bed / 床位状态这四个写接口没挂权限，只读账号也能改
  app.post<{ Body: { personId: number; operator?: string; note?: string } }>('/api/allocation/hold',
    { preHandler: requirePerm('allocation:write') }, async (req, reply) => {
    const personId = Number(req.body?.personId);
    const note = req.body?.note;
    const operator = actor(req);
    const existing = await currentOccupancy(personId);
    if (!existing) return reply.code(400).send({ error: '该人员当前没有床位' });
    if (!(await bedInScope(req, existing.bedId))) return reply.code(404).send(NOT_IN_SCOPE);
    if (existing.status !== 'ACTIVE') return reply.code(400).send({ error: '只有在住状态才能办理休假保留' });
    await prisma.$transaction(async (tx) => {
      await tx.occupancy.update({ where: { id: existing.id }, data: { status: 'HELD', note: note ?? '休假，床位保留' } });
      await tx.bed.update({ where: { id: existing.bedId }, data: { status: 'HELD' } });
      await tx.person.update({ where: { id: personId }, data: { employmentStatus: 'ON_LEAVE' } });
      await tx.occupancyEvent.create({ data: { type: 'HOLD', personId, bedId: existing.bedId, operator, note } });
    });
    await audit(req, 'HOLD', { targetType: 'Person', targetId: personId, detail: existing.bed.code });
    return { ok: true };
  });

  app.post<{ Body: { personId: number; operator?: string } }>('/api/allocation/resume',
    { preHandler: requirePerm('allocation:write') }, async (req, reply) => {
    const personId = Number(req.body?.personId);
    const operator = actor(req);
    const existing = await currentOccupancy(personId);
    if (!existing) return reply.code(400).send({ error: '该人员当前没有保留床位' });
    if (!(await bedInScope(req, existing.bedId))) return reply.code(404).send(NOT_IN_SCOPE);
    // 不校验的话，对在住的人点「返岗」会把休假周期起点重置成今天
    if (existing.status !== 'HELD') return reply.code(400).send({ error: '该人员不是休假保留状态' });
    await prisma.$transaction(async (tx) => {
      await tx.occupancy.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } });
      await tx.bed.update({ where: { id: existing.bedId }, data: { status: 'OCCUPIED' } });
      await tx.person.update({
        where: { id: personId },
        data: { employmentStatus: 'ACTIVE', cycleStartDate: new Date() },
      });
      await tx.occupancyEvent.create({ data: { type: 'RESUME', personId, bedId: existing.bedId, operator } });
    });
    await audit(req, 'RESUME', { targetType: 'Person', targetId: personId, detail: existing.bed.code });
    return { ok: true };
  });

  /**
   * 夫妻房一次安排两个人 —— 实际操作里宿管不会分两次做。
   * 会校验：房型是夫妻房、两人已登记且已核验配偶关系、房间是空的。
   */
  app.post<{ Body: { personIdA: number; personIdB: number; roomId: number; operator?: string; force?: boolean } }>(
    '/api/allocation/assign-couple',
    { preHandler: requirePerm('allocation:write') },
    async (req, reply) => {
      const personIdA = Number(req.body?.personIdA), personIdB = Number(req.body?.personIdB), roomId = Number(req.body?.roomId);
      const force = !!req.body?.force;
      const operator = actor(req);
      if (!(await roomInScope(req, roomId))) return reply.code(404).send(NOT_IN_SCOPE);
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

      try {
       await prisma.$transaction(async (tx) => {
        for (const [p, bed] of [[a, freeBeds[0]], [b, freeBeds[1]]] as const) {
          await claimBed(tx, bed.id, 'OCCUPIED');
          await tx.occupancy.create({
            data: { bedId: bed.id, personId: p.id, status: 'ACTIVE', assignedBy: operator, note: '夫妻房整体安排' },
          });
          await tx.occupancyEvent.create({
            data: { type: 'CHECKIN', personId: p.id, bedId: bed.id, operator, note: '夫妻房整体安排' },
          });
        }
       });
      } catch (e) {
        if (e instanceof BedTaken) return reply.code(409).send({ error: e.message });
        throw e;
      }
      await audit(req, 'ASSIGN_COUPLE', { targetType: 'Room', targetId: roomId, detail: `${a.name} + ${b.name}` });
      return { ok: true, roomCode: room.code, warnings: allWarnings };
    }
  );

  /** 加床（临时应急）。加床不计入核定人数，会单独标记 */
  app.post<{ Body: { roomId: number; label?: string; operator?: string; reason?: string } }>(
    '/api/allocation/extra-bed',
    { preHandler: requirePerm('allocation:write') },
    async (req, reply) => {
      const roomId = Number(req.body?.roomId);
      const { label, reason } = req.body ?? ({} as any);
      const operator = actor(req);
      if (!(await roomInScope(req, roomId))) return reply.code(404).send(NOT_IN_SCOPE);
      const room = await prisma.room.findUnique({ where: { id: roomId }, include: { beds: true, roomType: true } });
      if (!room) return reply.code(404).send({ error: '房间不存在' });
      if (!room.roomType.isResidential) return reply.code(400).send({ error: '功能房不能加床' });
      // 编号取「已有加床数 + 1」并避开已存在的编号 —— 按总床数算会和已有的 X 床撞 unique
      const codes = new Set(room.beds.map((b) => b.code));
      let n = room.beds.length + 1;
      while (codes.has(`${room.code}-X${n}`)) n++;
      const bed = await prisma.bed.create({
        data: {
          roomId, code: `${room.code}-X${n}`, label: label ?? `加床 ${n}`,
          position: 'SINGLE', status: 'FREE', isExtra: true,
          note: reason ?? '临时加床',
        },
      });
      await prisma.occupancyEvent.create({ data: { type: 'EXTRA_BED', bedId: bed.id, operator, note: reason } });
      await audit(req, 'EXTRA_BED', { targetType: 'Room', targetId: roomId, detail: bed.code });
      return { ok: true, bed };
    }
  );

  /** 床位状态直接调整：撤除（降标）/ 报修 / 恢复 */
  app.put<{ Params: { id: string }; Body: { status: string; note?: string } }>(
    '/api/beds/:id/status',
    { preHandler: requirePerm('space:room') },
    async (req, reply) => {
      const id = Number(req.params.id);
      const status = req.body?.status;
      // 手工只能在「可用 / 报修 / 封锁 / 撤除」之间切。占用、保留、预留只能由排宿流程产生，
      // 否则会出现床位显示已住、却没有任何入住记录的幽灵床
      if (!['FREE', 'MAINTENANCE', 'LOCKED', 'DISABLED'].includes(status))
        return reply.code(400).send({ error: '床位状态只能手工改为 可用 / 报修 / 封锁 / 撤除' });
      if (!(await bedInScope(req, id))) return reply.code(404).send(NOT_IN_SCOPE);
      const bed = await prisma.bed.findUnique({ where: { id }, include: { occupancies: { where: { status: { in: LIVE } } } } });
      if (!bed) return reply.code(404).send({ error: '床位不存在' });
      if (bed.occupancies.length > 0)
        return reply.code(400).send({ error: '该床位仍有在住人员，请先退宿或调宿' });
      const updated = await prisma.bed.update({ where: { id }, data: { status, note: req.body?.note ?? null } });
      await audit(req, 'BED_STATUS', { targetType: 'Bed', targetId: id, detail: `${bed.status} → ${status}` });
      return updated;
    }
  );
}
