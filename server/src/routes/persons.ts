import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { PERSON_INCLUDE, parseLangs } from '../services/space.js';

const LIVE = ['ACTIVE', 'HELD', 'RESERVED'];

const INCLUDE = {
  ...PERSON_INCLUDE,
  hostPerson: { select: { id: true, name: true, employeeNo: true } },
  dependents: { select: { id: true, name: true, employeeNo: true, personType: true, gender: true, birthDate: true } },
  occupancies: {
    where: { status: { in: LIVE } },
    include: { bed: { include: { room: { include: { roomType: true, floor: { include: { building: true } } } } } } },
  },
};

/** 按职级休假周期推算下次休假日期 */
export function nextLeaveDue(cycleStartDate: Date | null, leaveCycleMonths: number): Date | null {
  if (!cycleStartDate) return null;
  const d = new Date(cycleStartDate);
  const whole = Math.floor(leaveCycleMonths);
  const fracDays = Math.round((leaveCycleMonths - whole) * 30.4);
  d.setMonth(d.getMonth() + whole);
  d.setDate(d.getDate() + fracDays);
  return d;
}

const age = (birth: Date | null) =>
  birth ? Math.floor((Date.now() - birth.getTime()) / (365.25 * 86400000)) : null;

export function serializePerson(p: any) {
  const occ = p.occupancies?.[0];
  const due = p.positionLevel ? nextLeaveDue(p.cycleStartDate, p.positionLevel.leaveCycleMonths) : null;
  return {
    id: p.id, employeeNo: p.employeeNo, personType: p.personType,
    name: p.name, nameLocal: p.nameLocal, gender: p.gender,
    birthDate: p.birthDate, age: age(p.birthDate),
    nationalityId: p.nationalityId, nationalityName: p.nationality.nameZh, nationalityColor: p.nationality.color,
    idType: p.idType, idNumber: p.idNumber, idExpiryDate: p.idExpiryDate,
    idExpiryInDays: p.idExpiryDate ? Math.round((new Date(p.idExpiryDate).getTime() - Date.now()) / 86400000) : null,
    passportHeld: p.passportHeld,
    phone: p.phone, emergencyContact: p.emergencyContact, emergencyPhone: p.emergencyPhone,
    departmentId: p.departmentId, department: p.department?.nameZh ?? null,
    positionLevelId: p.positionLevelId, positionLevel: p.positionLevel?.nameZh ?? null,
    positionRank: p.positionLevel?.rank ?? 0, isLeadership: p.positionLevel?.isLeadership ?? false,
    coupleRoomAllowed: p.positionLevel?.coupleRoomAllowed ?? false,
    leaveCycleMonths: p.positionLevel?.leaveCycleMonths ?? null,
    nextLeaveDue: due,
    leaveDueInDays: due ? Math.round((due.getTime() - Date.now()) / 86400000) : null,
    shiftId: p.shiftId, shift: p.shift?.nameZh ?? null, shiftColor: p.shift?.color ?? null,
    contractorId: p.contractorId, contractor: p.contractor?.name ?? null, contractorIsSelf: p.contractor?.isSelf ?? true,
    religionId: p.religionId, religion: p.religion?.nameZh ?? null, hasDietaryRule: p.religion?.hasDietaryRule ?? false,
    languages: parseLangs(p.languages),
    isSmoker: p.isSmoker, needsLowerBunk: p.needsLowerBunk, needsGroundFloor: p.needsGroundFloor,
    hireDate: p.hireDate, employmentStatus: p.employmentStatus,
    hostPersonId: p.hostPersonId, hostPerson: p.hostPerson ?? null,
    dependents: p.dependents ?? [],
    note: p.note,
    accommodation: occ
      ? {
          occupancyId: occ.id, status: occ.status, checkInAt: occ.checkInAt,
          bedId: occ.bedId, bedCode: occ.bed.code, bedLabel: occ.bed.label, bedPosition: occ.bed.position,
          roomId: occ.bed.roomId, roomCode: occ.bed.room.code,
          roomType: occ.bed.room.roomType.nameZh, isCoupleRoom: occ.bed.room.roomType.isCoupleRoom,
          floorId: occ.bed.room.floorId, floorLevel: occ.bed.room.floor.level,
          buildingId: occ.bed.room.floor.buildingId,
          buildingCode: occ.bed.room.floor.building.code,
          buildingName: occ.bed.room.floor.building.name,
        }
      : null,
  };
}

export default async function personRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: Record<string, string | undefined>;
  }>('/api/persons', async (req) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Math.min(Number(req.query.pageSize ?? 30), 500);
    const q = req.query.q?.trim();

    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q } }, { nameLocal: { contains: q } },
        { employeeNo: { contains: q } }, { idNumber: { contains: q } }, { phone: { contains: q } },
      ];
    }
    if (req.query.nationalityId) where.nationalityId = req.query.nationalityId;
    if (req.query.departmentId) where.departmentId = Number(req.query.departmentId);
    if (req.query.positionLevelId) where.positionLevelId = Number(req.query.positionLevelId);
    if (req.query.shiftId) where.shiftId = Number(req.query.shiftId);
    if (req.query.contractorId) where.contractorId = Number(req.query.contractorId);
    if (req.query.religionId) where.religionId = Number(req.query.religionId);
    if (req.query.employmentStatus) where.employmentStatus = req.query.employmentStatus;
    if (req.query.personType) where.personType = req.query.personType;
    if (req.query.gender) where.gender = req.query.gender;
    if (req.query.needsLowerBunk === 'true') where.needsLowerBunk = true;
    if (req.query.needsGroundFloor === 'true') where.needsGroundFloor = true;
    if (req.query.housed === 'true') where.occupancies = { some: { status: { in: LIVE } } };
    if (req.query.housed === 'false') where.occupancies = { none: { status: { in: LIVE } } };
    if (req.query.buildingId) {
      where.occupancies = {
        some: { status: { in: LIVE }, bed: { room: { floor: { buildingId: Number(req.query.buildingId) } } } },
      };
    }

    const [total, rows] = await Promise.all([
      prisma.person.count({ where }),
      prisma.person.findMany({
        where, include: INCLUDE,
        orderBy: [{ employmentStatus: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    return { total, page, pageSize, rows: rows.map(serializePerson) };
  });

  app.get<{ Params: { id: string } }>('/api/persons/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const p = await prisma.person.findUnique({ where: { id }, include: INCLUDE });
    if (!p) return reply.code(404).send({ error: 'person not found' });

    const [history, rels, items, deposits, violations, workOrders] = await Promise.all([
      prisma.occupancy.findMany({
        where: { personId: id }, orderBy: { checkInAt: 'desc' },
        include: { bed: { include: { room: { include: { floor: { include: { building: true } } } } } } },
      }),
      prisma.relationship.findMany({
        where: { OR: [{ personId: id }, { relatedPersonId: id }] },
        include: {
          person: { select: { id: true, name: true, employeeNo: true, personType: true } },
          related: { select: { id: true, name: true, employeeNo: true, personType: true } },
        },
      }),
      prisma.issuedItem.findMany({ where: { personId: id }, include: { itemType: true }, orderBy: { issuedAt: 'desc' } }),
      prisma.deposit.findMany({ where: { personId: id }, orderBy: { paidAt: 'desc' } }),
      prisma.violation.findMany({ where: { personId: id }, include: { type: true }, orderBy: { occurredAt: 'desc' } }),
      prisma.workOrder.findMany({ where: { reportedById: id }, include: { category: true }, orderBy: { reportedAt: 'desc' }, take: 20 }),
    ]);

    const violationPoints = violations
      .filter((v) => v.status !== 'CLOSED')
      .reduce((s, v) => s + v.points, 0);

    return {
      ...serializePerson(p),
      violationPoints,
      history: history.map((h) => ({
        id: h.id, status: h.status, checkInAt: h.checkInAt, checkOutAt: h.checkOutAt,
        reason: h.reason, note: h.note,
        bedCode: h.bed.code, bedLabel: h.bed.label, roomCode: h.bed.room.code,
        buildingName: h.bed.room.floor.building.name, floorLevel: h.bed.room.floor.level,
      })),
      relationships: rels.map((r) => ({
        id: r.id, type: r.type, verified: r.verified, note: r.note,
        other: r.personId === id ? r.related : r.person,
        direction: r.personId === id ? 'OUT' : 'IN',
      })),
      issuedItems: items.map((i) => ({
        id: i.id, name: i.itemType.nameZh, code: i.itemType.code, quantity: i.quantity,
        issuedAt: i.issuedAt, returnedAt: i.returnedAt, condition: i.condition,
        price: i.itemType.price, deposit: i.itemType.deposit, compensation: i.compensation,
        isReturnable: i.itemType.isReturnable,
      })),
      deposits,
      violations: violations.map((v) => ({
        id: v.id, code: v.code, type: v.type.nameZh, severity: v.type.severity,
        occurredAt: v.occurredAt, points: v.points, fine: v.fine, status: v.status, action: v.action,
        description: v.description,
      })),
      workOrders: workOrders.map((w) => ({
        id: w.id, code: w.code, category: w.category.nameZh, title: w.title,
        status: w.status, reportedAt: w.reportedAt,
      })),
    };
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/persons/:id', async (req) => {
    const id = Number(req.params.id);
    const allowed = ['name', 'nameLocal', 'gender', 'nationalityId', 'idType', 'idNumber', 'idExpiryDate',
      'passportHeld', 'phone', 'emergencyContact', 'emergencyPhone', 'departmentId', 'positionLevelId',
      'positionTitle', 'shiftId', 'contractorId', 'religionId', 'languages', 'isSmoker',
      'needsLowerBunk', 'needsGroundFloor', 'employmentStatus', 'cycleStartDate', 'personType',
      'hostPersonId', 'birthDate', 'note'];
    const data: any = {};
    for (const k of allowed) if (k in req.body) data[k] = req.body[k];
    for (const k of ['cycleStartDate', 'birthDate', 'idExpiryDate']) {
      if (data[k]) data[k] = new Date(data[k]);
    }
    if (Array.isArray(data.languages)) data.languages = data.languages.join(',');
    return prisma.person.update({ where: { id }, data });
  });

  app.post<{ Body: Record<string, any> }>('/api/persons', async (req) => {
    const b = { ...req.body };
    for (const k of ['cycleStartDate', 'birthDate', 'idExpiryDate', 'hireDate']) if (b[k]) b[k] = new Date(b[k]);
    if (Array.isArray(b.languages)) b.languages = b.languages.join(',');
    return prisma.person.create({ data: b as any });
  });

  // ---------------- 亲属关系（夫妻房的前置条件） ----------------
  app.get<{ Querystring: { personId?: string; type?: string; verified?: string } }>(
    '/api/relationships',
    async (req) => {
      const where: any = {};
      if (req.query.type) where.type = req.query.type;
      if (req.query.verified) where.verified = req.query.verified === 'true';
      if (req.query.personId) {
        const id = Number(req.query.personId);
        where.OR = [{ personId: id }, { relatedPersonId: id }];
      }
      const rows = await prisma.relationship.findMany({
        where,
        include: {
          person: { include: { nationality: true, department: true, positionLevel: true } },
          related: { include: { nationality: true, department: true, positionLevel: true } },
        },
        orderBy: { id: 'desc' },
      });
      return rows.map((r) => ({
        id: r.id, type: r.type, verified: r.verified, verifiedBy: r.verifiedBy, note: r.note,
        a: { id: r.person.id, name: r.person.name, employeeNo: r.person.employeeNo, personType: r.person.personType,
             gender: r.person.gender, nationalityId: r.person.nationalityId,
             department: r.person.department?.nameZh ?? null, positionLevel: r.person.positionLevel?.nameZh ?? null },
        b: { id: r.related.id, name: r.related.name, employeeNo: r.related.employeeNo, personType: r.related.personType,
             gender: r.related.gender, nationalityId: r.related.nationalityId,
             department: r.related.department?.nameZh ?? null, positionLevel: r.related.positionLevel?.nameZh ?? null },
      }));
    }
  );

  app.post<{ Body: { personId: number; relatedPersonId: number; type: string; verified?: boolean; verifiedBy?: string; note?: string } }>(
    '/api/relationships',
    async (req, reply) => {
      const { personId, relatedPersonId, type } = req.body;
      if (personId === relatedPersonId) return reply.code(400).send({ error: '不能与自己建立关系' });
      const exists = await prisma.relationship.findFirst({
        where: {
          type,
          OR: [
            { personId, relatedPersonId },
            { personId: relatedPersonId, relatedPersonId: personId },
          ],
        },
      });
      if (exists) return reply.code(400).send({ error: '该关系已存在' });
      return prisma.relationship.create({ data: req.body });
    }
  );

  app.put<{ Params: { id: string }; Body: { verified?: boolean; verifiedBy?: string; note?: string } }>(
    '/api/relationships/:id',
    async (req) => prisma.relationship.update({ where: { id: Number(req.params.id) }, data: req.body })
  );

  app.delete<{ Params: { id: string } }>('/api/relationships/:id', async (req) =>
    prisma.relationship.delete({ where: { id: Number(req.params.id) } })
  );

  /** 一张床住过谁 —— 事故追溯 / 密接排查用 */
  app.get<{ Params: { id: string } }>('/api/beds/:id/history', async (req) => {
    const bedId = Number(req.params.id);
    const rows = await prisma.occupancy.findMany({
      where: { bedId }, orderBy: { checkInAt: 'desc' },
      include: { person: { include: { department: true, nationality: true } } },
    });
    return rows.map((r) => ({
      id: r.id, status: r.status, checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, reason: r.reason,
      person: { id: r.person.id, employeeNo: r.person.employeeNo, name: r.person.name,
        department: r.person.department?.nameZh ?? null, nationalityId: r.person.nationalityId },
    }));
  });

  /**
   * 密接排查：某人某段时间的同房间 / 同楼层接触者。
   * 时间区间模型天生支持这个查询 —— 传染病隔离、事故调查都用得上。
   */
  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string; scope?: string } }>(
    '/api/persons/:id/contacts',
    async (req, reply) => {
      const id = Number(req.params.id);
      const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 14 * 86400000);
      const to = req.query.to ? new Date(req.query.to) : new Date();
      const scope = req.query.scope ?? 'ROOM';

      const own = await prisma.occupancy.findMany({
        where: { personId: id, checkInAt: { lte: to }, OR: [{ checkOutAt: null }, { checkOutAt: { gte: from } }] },
        include: { bed: { include: { room: true } } },
      });
      if (own.length === 0) return reply.send({ contacts: [], windows: [] });

      const roomIds = [...new Set(own.map((o) => o.bed.roomId))];
      const floorIds = [...new Set(own.map((o) => o.bed.room.floorId))];

      const others = await prisma.occupancy.findMany({
        where: {
          personId: { not: id },
          checkInAt: { lte: to },
          OR: [{ checkOutAt: null }, { checkOutAt: { gte: from } }],
          bed: scope === 'FLOOR' ? { room: { floorId: { in: floorIds } } } : { roomId: { in: roomIds } },
        },
        include: {
          person: { include: { department: true, nationality: true } },
          bed: { include: { room: { include: { floor: { include: { building: true } } } } } },
        },
      });

      return {
        windows: own.map((o) => ({ roomId: o.bed.roomId, from: o.checkInAt, to: o.checkOutAt })),
        scope,
        contacts: others.map((o) => ({
          personId: o.person.id, name: o.person.name, employeeNo: o.person.employeeNo,
          department: o.person.department?.nameZh ?? null, nationalityId: o.person.nationalityId,
          roomCode: o.bed.room.code, bedLabel: o.bed.label,
          buildingName: o.bed.room.floor.building.name, floorLevel: o.bed.room.floor.level,
          overlapFrom: o.checkInAt, overlapTo: o.checkOutAt,
        })),
      };
    }
  );
}
