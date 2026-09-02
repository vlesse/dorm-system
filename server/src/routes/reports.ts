import type { FastifyInstance } from 'fastify';
import { prisma, getSetting } from '../db.js';
import { nextLeaveDue } from './persons.js';

const LIVE = ['ACTIVE', 'HELD', 'RESERVED'];

export default async function reportRoutes(app: FastifyInstance) {
  /** 总览看板 */
  app.get('/api/dashboard', async () => {
    const beds = await prisma.bed.groupBy({ by: ['status'], _count: true });
    const bedStats: Record<string, number> = {};
    for (const b of beds) bedStats[b.status] = b._count;
    const totalBeds = beds.reduce((s, b) => s + b._count, 0);
    const inUse = (bedStats.OCCUPIED ?? 0) + (bedStats.HELD ?? 0) + (bedStats.RESERVED ?? 0);
    const usable = totalBeds - (bedStats.MAINTENANCE ?? 0) - (bedStats.LOCKED ?? 0);

    const buildings = await prisma.building.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        nationality: true,
        floors: { include: { rooms: { include: { beds: { select: { status: true } } } } } },
      },
    });

    const byBuilding = buildings.map((b) => {
      const bs = b.floors.flatMap((f) => f.rooms.flatMap((r) => r.beds));
      const occupied = bs.filter((x) => x.status === 'OCCUPIED').length;
      const held = bs.filter((x) => x.status === 'HELD').length;
      const free = bs.filter((x) => x.status === 'FREE').length;
      const oos = bs.filter((x) => ['MAINTENANCE', 'LOCKED'].includes(x.status)).length;
      return {
        id: b.id, code: b.code, name: b.name, floorCount: b.floors.length,
        nationalityId: b.nationalityId, nationalityColor: b.nationality?.color ?? null,
        genderPolicy: b.genderPolicy,
        total: bs.length, occupied, held, free, oos,
        rate: bs.length ? (occupied + held) / Math.max(bs.length - oos, 1) : 0,
      };
    });

    // 在住人员按国籍 / 部门 / 房型分布
    const liveOcc = await prisma.occupancy.findMany({
      where: { status: { in: ['ACTIVE', 'HELD'] } },
      include: {
        person: { include: { nationality: true, department: true, positionLevel: true, contractor: true } },
        bed: { include: { room: { include: { roomType: true } } } },
      },
    });

    const tally = <T extends string | number>(items: T[]) => {
      const m = new Map<T, number>();
      for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
      return m;
    };
    const nats = await prisma.nationality.findMany({ orderBy: { sortOrder: 'asc' } });
    const natMap = tally(liveOcc.map((o) => o.person.nationalityId));
    const byNationality = nats
      .map((n) => ({ id: n.id, name: n.nameZh, color: n.color, count: natMap.get(n.id) ?? 0 }))
      .filter((n) => n.count > 0);

    const deptMap = tally(liveOcc.map((o) => o.person.department.nameZh));
    const byDepartment = [...deptMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const rtMap = tally(liveOcc.map((o) => o.bed.room.roomType.nameZh));
    const byRoomType = [...rtMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    const conMap = tally(liveOcc.map((o) => o.person.contractor.name));
    const byContractor = [...conMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    const [personTotal, housed, unhoused] = await Promise.all([
      prisma.person.count(),
      prisma.person.count({ where: { occupancies: { some: { status: { in: LIVE } } } } }),
      prisma.person.count({ where: { employmentStatus: { not: 'RESIGNED' }, occupancies: { none: { status: { in: LIVE } } } } }),
    ]);

    const alerts = await computeAlerts();

    return {
      beds: {
        total: totalBeds, usable, inUse,
        occupied: bedStats.OCCUPIED ?? 0, held: bedStats.HELD ?? 0,
        reserved: bedStats.RESERVED ?? 0, free: bedStats.FREE ?? 0,
        maintenance: (bedStats.MAINTENANCE ?? 0) + (bedStats.LOCKED ?? 0),
        rate: usable ? inUse / usable : 0,
      },
      persons: { total: personTotal, housed, unhoused },
      byBuilding, byNationality, byDepartment, byRoomType, byContractor,
      alertCounts: {
        resignedStillHoused: alerts.resignedStillHoused.length,
        leaveDueSoon: alerts.leaveDueSoon.length,
        reservedStale: alerts.reservedStale.length,
        statusMismatch: alerts.statusMismatch.length,
      },
    };
  });

  /** 待办告警 —— 这几条是宿管系统数据烂掉的主要来源 */
  app.get('/api/alerts', async () => computeAlerts());

  /** 在住花名册（消防疏散 / 检查用），可按楼栋楼层过滤 */
  app.get<{ Querystring: { buildingId?: string; floorId?: string; nationalityId?: string } }>(
    '/api/roster',
    async (req) => rosterRows(req.query)
  );

  /** 花名册 CSV 导出，带 BOM，Excel 直接打开不乱码 */
  app.get<{ Querystring: { buildingId?: string; floorId?: string; nationalityId?: string } }>(
    '/api/roster.csv',
    async (req, reply) => {
      const rows = await rosterRows(req.query);
      const header = ['楼栋', '楼层', '房间', '床位', '工号', '姓名', '性别', '国籍', '证件号', '部门', '职级', '班次', '雇佣主体', '入住日期', '状态'];
      const csv = [header.join(',')]
        .concat(
          rows.map((r) =>
            [r.buildingName, r.floorLevel, r.roomCode, r.bedLabel, r.employeeNo, r.name,
             r.gender === 'MALE' ? '男' : '女', r.nationality, r.idNumber, r.department,
             r.positionLevel, r.shift ?? '', r.contractor,
             new Date(r.checkInAt).toISOString().slice(0, 10),
             r.status === 'HELD' ? '休假保留' : r.status === 'RESERVED' ? '待入住' : '在住',
            ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
          )
        )
        .join('\r\n');
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="roster-${new Date().toISOString().slice(0, 10)}.csv"`);
      return '﻿' + csv;
    }
  );
}

async function rosterRows(q: { buildingId?: string; floorId?: string; nationalityId?: string }) {
  const where: any = { status: { in: LIVE } };
  if (q.floorId) where.bed = { room: { floorId: Number(q.floorId) } };
  else if (q.buildingId) where.bed = { room: { floor: { buildingId: Number(q.buildingId) } } };
  if (q.nationalityId) where.person = { nationalityId: q.nationalityId };

  const rows = await prisma.occupancy.findMany({
    where,
    include: {
      person: { include: { nationality: true, department: true, positionLevel: true, shift: true, contractor: true } },
      bed: { include: { room: { include: { floor: { include: { building: true } } } } } },
    },
    orderBy: [{ bed: { code: 'asc' } }],
  });
  return rows.map((o) => ({
    occupancyId: o.id, status: o.status, checkInAt: o.checkInAt,
    buildingId: o.bed.room.floor.buildingId,
    buildingName: o.bed.room.floor.building.name,
    buildingCode: o.bed.room.floor.building.code,
    floorId: o.bed.room.floorId, floorLevel: o.bed.room.floor.level,
    roomCode: o.bed.room.code, bedCode: o.bed.code, bedLabel: o.bed.label,
    personId: o.person.id, employeeNo: o.person.employeeNo, name: o.person.name,
    gender: o.person.gender, nationality: o.person.nationality.nameZh,
    nationalityId: o.person.nationalityId, nationalityColor: o.person.nationality.color,
    idNumber: o.person.idNumber, department: o.person.department.nameZh,
    positionLevel: o.person.positionLevel.nameZh, shift: o.person.shift?.nameZh ?? null,
    contractor: o.person.contractor.name, phone: o.person.phone,
    employmentStatus: o.person.employmentStatus,
  }));
}

async function computeAlerts() {
  const warningDays = await getSetting<number>('leave.warningDays', 30);

  // 1. 已离职但床位没释放 —— 头号问题
  const resignedRows = await prisma.occupancy.findMany({
    where: { status: { in: LIVE }, person: { employmentStatus: 'RESIGNED' } },
    include: {
      person: { include: { department: true, nationality: true } },
      bed: { include: { room: { include: { floor: { include: { building: true } } } } } },
    },
  });

  // 2. 休假即将到期（按职级各自的周期推算）
  const actives = await prisma.person.findMany({
    where: { employmentStatus: 'ACTIVE', cycleStartDate: { not: null } },
    include: { positionLevel: true, department: true },
  });
  const leaveDueSoon = actives
    .map((p) => {
      const due = nextLeaveDue(p.cycleStartDate, p.positionLevel.leaveCycleMonths)!;
      return {
        personId: p.id, employeeNo: p.employeeNo, name: p.name,
        department: p.department.nameZh, positionLevel: p.positionLevel.nameZh,
        leaveCycleMonths: p.positionLevel.leaveCycleMonths,
        dueAt: due, inDays: Math.round((due.getTime() - Date.now()) / 86400000),
      };
    })
    .filter((x) => x.inDays <= warningDays)
    .sort((a, b) => a.inDays - b.inDays);

  // 3. 已分配床位但超过 3 天没办入住
  const reservedStale = await prisma.occupancy.findMany({
    where: { status: 'RESERVED', createdAt: { lt: new Date(Date.now() - 3 * 86400000) } },
    include: { person: true, bed: true },
  });

  // 4. 员工状态与床位状态口径不一致（休假中却算在住 / 在职却是保留）
  const mismatchRaw = await prisma.occupancy.findMany({
    where: {
      OR: [
        { status: 'ACTIVE', person: { employmentStatus: 'ON_LEAVE' } },
        { status: 'HELD', person: { employmentStatus: 'ACTIVE' } },
      ],
    },
    include: { person: true, bed: true },
  });

  return {
    warningDays,
    resignedStillHoused: resignedRows.map((o) => ({
      occupancyId: o.id, personId: o.personId, employeeNo: o.person.employeeNo,
      name: o.person.name, department: o.person.department.nameZh,
      nationalityId: o.person.nationalityId,
      bedId: o.bedId, bedCode: o.bed.code, roomCode: o.bed.room.code,
      buildingName: o.bed.room.floor.building.name,
      checkInAt: o.checkInAt,
      daysHeld: Math.round((Date.now() - o.checkInAt.getTime()) / 86400000),
    })),
    leaveDueSoon,
    reservedStale: reservedStale.map((o) => ({
      occupancyId: o.id, personId: o.personId, name: o.person.name,
      employeeNo: o.person.employeeNo, bedCode: o.bed.code, createdAt: o.createdAt,
    })),
    statusMismatch: mismatchRaw.map((o) => ({
      occupancyId: o.id, personId: o.personId, name: o.person.name,
      employeeNo: o.person.employeeNo, occupancyStatus: o.status,
      employmentStatus: o.person.employmentStatus, bedCode: o.bed.code,
    })),
  };
}
