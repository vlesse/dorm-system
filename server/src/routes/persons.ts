import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

const LIVE = ['ACTIVE', 'HELD', 'RESERVED'];

const INCLUDE = {
  nationality: true, department: true, positionLevel: true, shift: true, contractor: true,
  occupancies: {
    where: { status: { in: LIVE } },
    include: { bed: { include: { room: { include: { floor: { include: { building: true } } } } } } },
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

export function serializePerson(p: any) {
  const occ = p.occupancies?.[0];
  const due = nextLeaveDue(p.cycleStartDate, p.positionLevel.leaveCycleMonths);
  return {
    id: p.id, employeeNo: p.employeeNo, name: p.name, nameLocal: p.nameLocal, gender: p.gender,
    nationalityId: p.nationalityId, nationalityName: p.nationality.nameZh, nationalityColor: p.nationality.color,
    idType: p.idType, idNumber: p.idNumber, phone: p.phone,
    departmentId: p.departmentId, department: p.department.nameZh,
    positionLevelId: p.positionLevelId, positionLevel: p.positionLevel.nameZh,
    positionRank: p.positionLevel.rank, isLeadership: p.positionLevel.isLeadership,
    leaveCycleMonths: p.positionLevel.leaveCycleMonths,
    nextLeaveDue: due,
    leaveDueInDays: due ? Math.round((due.getTime() - Date.now()) / 86400000) : null,
    shiftId: p.shiftId, shift: p.shift?.nameZh ?? null, shiftColor: p.shift?.color ?? null,
    contractorId: p.contractorId, contractor: p.contractor.name, contractorIsSelf: p.contractor.isSelf,
    hireDate: p.hireDate, employmentStatus: p.employmentStatus,
    accommodation: occ
      ? {
          occupancyId: occ.id, status: occ.status, checkInAt: occ.checkInAt,
          bedId: occ.bedId, bedCode: occ.bed.code, bedLabel: occ.bed.label,
          roomId: occ.bed.roomId, roomCode: occ.bed.room.code,
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
    Querystring: {
      q?: string; page?: string; pageSize?: string;
      nationalityId?: string; departmentId?: string; positionLevelId?: string;
      shiftId?: string; contractorId?: string; employmentStatus?: string;
      housed?: string; buildingId?: string;
    };
  }>('/api/persons', async (req) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Math.min(Number(req.query.pageSize ?? 30), 200);
    const q = req.query.q?.trim();

    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { nameLocal: { contains: q } },
        { employeeNo: { contains: q } },
        { idNumber: { contains: q } },
        { phone: { contains: q } },
      ];
    }
    if (req.query.nationalityId) where.nationalityId = req.query.nationalityId;
    if (req.query.departmentId) where.departmentId = Number(req.query.departmentId);
    if (req.query.positionLevelId) where.positionLevelId = Number(req.query.positionLevelId);
    if (req.query.shiftId) where.shiftId = Number(req.query.shiftId);
    if (req.query.contractorId) where.contractorId = Number(req.query.contractorId);
    if (req.query.employmentStatus) where.employmentStatus = req.query.employmentStatus;
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
    // 住宿历史 —— 时间区间模型的价值就在这里，一张床住过谁全都查得到
    const history = await prisma.occupancy.findMany({
      where: { personId: id },
      orderBy: { checkInAt: 'desc' },
      include: { bed: { include: { room: { include: { floor: { include: { building: true } } } } } } },
    });
    return {
      ...serializePerson(p),
      history: history.map((h) => ({
        id: h.id, status: h.status, checkInAt: h.checkInAt, checkOutAt: h.checkOutAt,
        reason: h.reason, note: h.note,
        bedCode: h.bed.code, roomCode: h.bed.room.code,
        buildingName: h.bed.room.floor.building.name, floorLevel: h.bed.room.floor.level,
      })),
    };
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/persons/:id', async (req) => {
    const id = Number(req.params.id);
    const allowed = ['name', 'nameLocal', 'gender', 'nationalityId', 'idType', 'idNumber', 'phone',
      'departmentId', 'positionLevelId', 'positionTitle', 'shiftId', 'contractorId',
      'employmentStatus', 'cycleStartDate', 'note'];
    const data: any = {};
    for (const k of allowed) if (k in req.body) data[k] = req.body[k];
    if (data.cycleStartDate) data.cycleStartDate = new Date(data.cycleStartDate);
    return prisma.person.update({ where: { id }, data });
  });

  /** 一张床住过谁 —— 事故追溯用 */
  app.get<{ Params: { id: string } }>('/api/beds/:id/history', async (req) => {
    const bedId = Number(req.params.id);
    const rows = await prisma.occupancy.findMany({
      where: { bedId }, orderBy: { checkInAt: 'desc' },
      include: { person: { include: { department: true, nationality: true } } },
    });
    return rows.map((r) => ({
      id: r.id, status: r.status, checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, reason: r.reason,
      person: { id: r.person.id, employeeNo: r.person.employeeNo, name: r.person.name,
        department: r.person.department.nameZh, nationalityId: r.person.nationalityId },
    }));
  });
}
