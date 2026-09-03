import type { FastifyInstance } from 'fastify';
import { prisma, getSetting } from '../db.js';
import { nextLeaveDue } from './persons.js';
import { buildingScope } from '../services/auth.js';

const LIVE = ['ACTIVE', 'HELD', 'RESERVED'];
const OUT_OF_SERVICE = ['MAINTENANCE', 'LOCKED', 'DISABLED'];

export default async function reportRoutes(app: FastifyInstance) {
  /** 总览看板 */
  app.get('/api/dashboard', async (req) => {
    const scope = buildingScope(req);
    const bedScope = scope ? { room: { floor: { buildingId: { in: scope } } } } : {};
    const beds = await prisma.bed.groupBy({ by: ['status'], _count: true, where: bedScope });
    const bedStats: Record<string, number> = {};
    for (const b of beds) bedStats[b.status] = b._count;
    const totalBeds = beds.reduce((s, b) => s + b._count, 0);
    const disabled = bedStats.DISABLED ?? 0;
    const oos = (bedStats.MAINTENANCE ?? 0) + (bedStats.LOCKED ?? 0);
    const inUse = (bedStats.OCCUPIED ?? 0) + (bedStats.HELD ?? 0) + (bedStats.RESERVED ?? 0);
    // 可用床位 = 总床位 - 撤除 - 维修封锁
    const usable = totalBeds - disabled - oos;

    const buildings = await prisma.building.findMany({
      where: scope ? { id: { in: scope } } : {},
      orderBy: { sortOrder: 'asc' },
      include: {
        nationality: true,
        floors: { include: { rooms: { include: { roomType: true, beds: { select: { status: true } } } } } },
      },
    });

    const byBuilding = buildings.map((b) => {
      const rooms = b.floors.flatMap((f) => f.rooms);
      const bs = rooms.flatMap((r) => r.beds);
      const occupied = bs.filter((x) => x.status === 'OCCUPIED').length;
      const held = bs.filter((x) => x.status === 'HELD').length;
      const free = bs.filter((x) => x.status === 'FREE').length;
      const dis = bs.filter((x) => x.status === 'DISABLED').length;
      const mnt = bs.filter((x) => ['MAINTENANCE', 'LOCKED'].includes(x.status)).length;
      const denom = Math.max(bs.length - dis - mnt, 1);
      return {
        id: b.id, code: b.code, name: b.name, floorCount: b.floors.length,
        nationalityId: b.nationalityId, nationalityColor: b.nationality?.color ?? null,
        genderPolicy: b.genderPolicy, hasElevator: b.hasElevator,
        roomCount: rooms.length,
        functionRoomCount: rooms.filter((r) => !r.roomType.isResidential).length,
        deratedRoomCount: rooms.filter((r) => r.deratedReason).length,
        total: bs.length, occupied, held, free, disabled: dis, oos: mnt,
        rate: (occupied + held) / denom,
      };
    });

    const liveOcc = await prisma.occupancy.findMany({
      where: { status: { in: ['ACTIVE', 'HELD'] }, ...(scope ? { bed: bedScope } : {}) },
      include: {
        person: { include: { nationality: true, department: true, positionLevel: true, contractor: true, religion: true } },
        bed: { include: { room: { include: { roomType: true } } } },
      },
    });

    const tally = <T extends string | number>(items: T[]) => {
      const m = new Map<T, number>();
      for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
      return m;
    };
    const toRows = (m: Map<string, number>) =>
      [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    const nats = await prisma.nationality.findMany({ orderBy: { sortOrder: 'asc' } });
    const natMap = tally(liveOcc.map((o) => o.person.nationalityId));
    const byNationality = nats
      .map((n) => ({ id: n.id, name: n.nameZh, color: n.color, count: natMap.get(n.id) ?? 0 }))
      .filter((n) => n.count > 0);

    const byDepartment = toRows(tally(liveOcc.map((o) => o.person.department?.nameZh ?? '未分配')));
    const byRoomType = toRows(tally(liveOcc.map((o) => o.bed.room.roomType.nameZh)));
    const byContractor = toRows(tally(liveOcc.map((o) => o.person.contractor?.name ?? '未登记')));
    const byPersonType = toRows(tally(liveOcc.map((o) =>
      ({ EMPLOYEE: '员工', DEPENDENT: '家属随迁', VISITOR: '长期访客', INTERN: '实习生' } as any)[o.person.personType] ?? o.person.personType)));

    // 有楼栋范围时，人员口径 = 住在这几栋楼里的人；没范围时才是全园区
    const inScopeOcc = scope ? { some: { status: { in: LIVE }, bed: bedScope } } : { some: { status: { in: LIVE } } };
    const [personTotal, employeeTotal, dependentTotal, housed, unhoused] = await Promise.all([
      scope ? prisma.person.count({ where: { occupancies: inScopeOcc } }) : prisma.person.count(),
      prisma.person.count({ where: { personType: 'EMPLOYEE', ...(scope ? { occupancies: inScopeOcc } : {}) } }),
      prisma.person.count({ where: { personType: 'DEPENDENT', ...(scope ? { occupancies: inScopeOcc } : {}) } }),
      prisma.person.count({ where: { occupancies: inScopeOcc } }),
      scope ? 0 as any : prisma.person.count({ where: { employmentStatus: { not: 'RESIGNED' }, occupancies: { none: { status: { in: LIVE } } } } }),
    ]);

    // 房型维度：核定 vs 标称 vs 实住
    const roomTypeRows = await prisma.roomType.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        rooms: {
          where: scope ? { floor: { buildingId: { in: scope } } } : {},
          include: { beds: { select: { status: true } } },
        },
      },
    });
    const roomTypeStats = roomTypeRows.map((rt) => {
      const rooms = rt.rooms;
      const beds = rooms.flatMap((r) => r.beds);
      return {
        id: rt.id, code: rt.code, name: rt.nameZh, color: rt.color,
        isResidential: rt.isResidential, isCoupleRoom: rt.isCoupleRoom,
        managementMode: rt.managementMode, nominalCapacity: rt.defaultCapacity,
        roomCount: rooms.length,
        deratedCount: rooms.filter((r) => r.deratedReason).length,
        approvedCapacity: rooms.reduce((s, r) => s + r.capacity, 0),
        nominalTotal: rooms.length * rt.defaultCapacity,
        bedTotal: beds.length,
        occupied: beds.filter((b) => b.status === 'OCCUPIED').length,
        held: beds.filter((b) => b.status === 'HELD').length,
        free: beds.filter((b) => b.status === 'FREE').length,
        disabled: beds.filter((b) => b.status === 'DISABLED').length,
      };
    }).filter((r) => r.roomCount > 0);

    // 工单挂在房间上，范围内的房间 id 先算出来
    const scopedRoomIds = scope
      ? (await prisma.room.findMany({ where: { floor: { buildingId: { in: scope } } }, select: { id: true } })).map((r) => r.id)
      : null;
    const woScope = scopedRoomIds ? { scopeType: 'ROOM', scopeId: { in: scopedRoomIds } } : {};
    const [woOpen, woOverdueRaw, vioOpen, visitorIn, reqPending] = await Promise.all([
      prisma.workOrder.count({ where: { status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] }, ...woScope } }),
      prisma.workOrder.findMany({
        where: { status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] }, ...woScope },
        include: { category: true },
      }),
      prisma.violation.count({ where: { status: 'OPEN', ...(scopedRoomIds ? { roomId: { in: scopedRoomIds } } : {}) } }),
      prisma.visitor.count({ where: { status: 'IN' } }),
      prisma.request.count({ where: { status: 'PENDING' } }),
    ]);
    const woOverdue = woOverdueRaw.filter(
      (w) => Date.now() > w.reportedAt.getTime() + w.category.slaHours * 3600000
    ).length;

    const alerts = await computeAlerts(scope);
    const alertCounts = Object.fromEntries(
      Object.entries(alerts).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as any[]).length])
    );

    return {
      beds: {
        total: totalBeds, usable, inUse,
        occupied: bedStats.OCCUPIED ?? 0, held: bedStats.HELD ?? 0,
        reserved: bedStats.RESERVED ?? 0, free: bedStats.FREE ?? 0,
        maintenance: oos, disabled,
        rate: usable ? inUse / usable : 0,
      },
      persons: { total: personTotal, employees: employeeTotal, dependents: dependentTotal, housed, unhoused },
      operations: { workOrdersOpen: woOpen, workOrdersOverdue: woOverdue, violationsOpen: vioOpen, visitorsIn: visitorIn, requestsPending: reqPending },
      byBuilding, byNationality, byDepartment, byRoomType, byContractor, byPersonType,
      roomTypeStats,
      alertCounts,
    };
  });

  /** 待办告警 */
  app.get('/api/alerts', async (req) => computeAlerts(buildingScope(req)));

  /** 在住花名册 */
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/roster', async (req) =>
    rosterRows(req.query, buildingScope(req)));

  /** 花名册 CSV 导出，带 BOM，Excel 直接打开不乱码 */
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/roster.csv', async (req, reply) => {
    const rows = await rosterRows(req.query, buildingScope(req));
    const header = ['楼栋', '楼层', '房间', '房型', '床位', '工号', '姓名', '人员类型', '性别', '国籍',
      '证件类型', '证件号', '证件到期', '部门', '职级', '班次', '雇佣主体', '宗教', '联系电话',
      '紧急联系人', '紧急电话', '入住日期', '住宿状态'];
    const typeMap: any = { EMPLOYEE: '员工', DEPENDENT: '家属', VISITOR: '访客', INTERN: '实习生' };
    const csv = [header.join(',')]
      .concat(rows.map((r) => [
        r.buildingName, r.floorLevel, r.roomCode, r.roomType, r.bedLabel, r.employeeNo, r.name,
        typeMap[r.personType] ?? r.personType,
        r.gender === 'MALE' ? '男' : '女', r.nationality, r.idType, r.idNumber,
        r.idExpiryDate ? new Date(r.idExpiryDate).toISOString().slice(0, 10) : '',
        r.department ?? '', r.positionLevel ?? '', r.shift ?? '', r.contractor ?? '', r.religion ?? '',
        r.phone ?? '', r.emergencyContact ?? '', r.emergencyPhone ?? '',
        new Date(r.checkInAt).toISOString().slice(0, 10),
        r.status === 'HELD' ? '休假保留' : r.status === 'RESERVED' ? '待入住' : '在住',
      ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')))
      .join('\r\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="roster-${new Date().toISOString().slice(0, 10)}.csv"`);
    return '﻿' + csv;
  });

  /**
   * 消防疏散清单：按楼栋 → 楼层汇总人数，用于疏散点名。
   * 这是应急时最先要的东西，要能一屏看完。
   */
  app.get<{ Querystring: { buildingId?: string } }>('/api/evacuation', async (req) => {
    const scope = buildingScope(req);
    const buildings = await prisma.building.findMany({
      where: {
        ...(req.query.buildingId ? { id: Number(req.query.buildingId) } : {}),
        ...(scope ? { id: { in: scope } } : {}),
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        floors: {
          orderBy: { level: 'desc' },
          include: {
            rooms: {
              include: {
                roomType: true,
                beds: {
                  include: {
                    occupancies: {
                      where: { status: { in: ['ACTIVE', 'HELD'] } },
                      include: { person: { include: { nationality: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    return buildings.map((b) => ({
      id: b.id, code: b.code, name: b.name, hasElevator: b.hasElevator,
      total: b.floors.reduce((s, f) => s + f.rooms.reduce((s2, r) => s2 + r.beds.reduce((s3, bd) => s3 + bd.occupancies.length, 0), 0), 0),
      floors: b.floors.map((f) => {
        const people = f.rooms.flatMap((r) => r.beds.flatMap((bd) => bd.occupancies.map((o) => ({
          personId: o.person.id, name: o.person.name, employeeNo: o.person.employeeNo,
          nationalityId: o.person.nationalityId, roomCode: r.code,
          status: o.status,
          needsHelp: o.person.needsGroundFloor,
        }))));
        return {
          id: f.id, level: f.level, count: people.length,
          needsHelpCount: people.filter((p) => p.needsHelp).length,
          people,
        };
      }),
    }));
  });
}

async function rosterRows(q: Record<string, string | undefined>, scope: number[] | null = null) {
  const where: any = { status: { in: LIVE } };
  if (scope) where.bed = { room: { floor: { buildingId: { in: scope } } } };
  if (q.floorId) where.bed = { room: { floorId: Number(q.floorId) } };
  else if (q.buildingId) where.bed = { room: { floor: { buildingId: Number(q.buildingId) } } };
  if (q.nationalityId) where.person = { ...(where.person ?? {}), nationalityId: q.nationalityId };
  if (q.personType) where.person = { ...(where.person ?? {}), personType: q.personType };
  if (q.roomTypeId) where.bed = { ...(where.bed ?? {}), room: { ...(where.bed?.room ?? {}), roomTypeId: Number(q.roomTypeId) } };

  const rows = await prisma.occupancy.findMany({
    where,
    include: {
      person: { include: { nationality: true, department: true, positionLevel: true, shift: true, contractor: true, religion: true } },
      bed: { include: { room: { include: { roomType: true, floor: { include: { building: true } } } } } },
    },
    orderBy: [{ bed: { code: 'asc' } }],
  });
  return rows.map((o) => ({
    occupancyId: o.id, status: o.status, checkInAt: o.checkInAt,
    buildingId: o.bed.room.floor.buildingId,
    buildingName: o.bed.room.floor.building.name,
    buildingCode: o.bed.room.floor.building.code,
    floorId: o.bed.room.floorId, floorLevel: o.bed.room.floor.level,
    roomCode: o.bed.room.code, roomType: o.bed.room.roomType.nameZh,
    bedCode: o.bed.code, bedLabel: o.bed.label,
    personId: o.person.id, employeeNo: o.person.employeeNo, name: o.person.name,
    personType: o.person.personType,
    gender: o.person.gender, nationality: o.person.nationality.nameZh,
    nationalityId: o.person.nationalityId, nationalityColor: o.person.nationality.color,
    idType: o.person.idType, idNumber: o.person.idNumber, idExpiryDate: o.person.idExpiryDate,
    department: o.person.department?.nameZh ?? null,
    positionLevel: o.person.positionLevel?.nameZh ?? null,
    shift: o.person.shift?.nameZh ?? null,
    contractor: o.person.contractor?.name ?? null,
    religion: o.person.religion?.nameZh ?? null,
    phone: o.person.phone, emergencyContact: o.person.emergencyContact, emergencyPhone: o.person.emergencyPhone,
    employmentStatus: o.person.employmentStatus,
  }));
}

/**
 * 全部待办告警。每一条都是实际运营里会出问题、而且不查就发现不了的地方。
 */
async function computeAlerts(scope: number[] | null = null) {
  const [warningDays, idWarnDays, staleDays, pointsThreshold] = await Promise.all([
    getSetting<number>('leave.warningDays', 30),
    getSetting<number>('id.expiryWarningDays', 90),
    getSetting<number>('reserved.staleDays', 3),
    getSetting<number>('violation.pointsThreshold', 10),
  ]);

  // 有楼栋范围时，所有「跟位置有关」的告警都只看范围内的
  const bedScope = scope ? { room: { floor: { buildingId: { in: scope } } } } : null;
  const roomScope = scope ? { floor: { buildingId: { in: scope } } } : {};
  /** 该人当前是否住在范围内 —— 人员类告警靠这个收口 */
  const personInScope = bedScope ? { occupancies: { some: { status: { in: LIVE }, bed: bedScope } } } : {};

  // 1. 已离职但床位没释放
  const resignedRows = await prisma.occupancy.findMany({
    where: {
      status: { in: LIVE }, person: { employmentStatus: 'RESIGNED' },
      ...(bedScope ? { bed: bedScope } : {}),
    },
    include: {
      person: { include: { department: true, nationality: true } },
      bed: { include: { room: { include: { floor: { include: { building: true } } } } } },
    },
  });

  // 2. 休假即将到期
  const actives = await prisma.person.findMany({
    where: {
      employmentStatus: 'ACTIVE', cycleStartDate: { not: null }, positionLevelId: { not: null },
      ...personInScope,
    },
    include: { positionLevel: true, department: true },
  });
  const leaveDueSoon = actives
    .map((p) => {
      const due = nextLeaveDue(p.cycleStartDate, p.positionLevel!.leaveCycleMonths)!;
      return {
        personId: p.id, employeeNo: p.employeeNo, name: p.name,
        department: p.department?.nameZh ?? null, positionLevel: p.positionLevel!.nameZh,
        leaveCycleMonths: p.positionLevel!.leaveCycleMonths,
        dueAt: due, inDays: Math.round((due.getTime() - Date.now()) / 86400000),
      };
    })
    .filter((x) => x.inDays <= warningDays)
    .sort((a, b) => a.inDays - b.inDays);

  // 3. 已分配床位但超期未入住
  const reservedStale = await prisma.occupancy.findMany({
    where: {
      status: 'RESERVED', createdAt: { lt: new Date(Date.now() - staleDays * 86400000) },
      ...(bedScope ? { bed: bedScope } : {}),
    },
    include: { person: true, bed: true },
  });

  // 4. 员工状态与床位状态口径不一致
  const mismatchRaw = await prisma.occupancy.findMany({
    where: {
      OR: [
        { status: 'ACTIVE', person: { employmentStatus: 'ON_LEAVE' } },
        { status: 'HELD', person: { employmentStatus: 'ACTIVE' } },
      ],
    },
    include: { person: true, bed: true },
  });

  // 5. 证件（护照 / KITAS）即将到期 —— 在印尼这是会出大事的
  const idExpiring = await prisma.person.findMany({
    where: {
      employmentStatus: { not: 'RESIGNED' },
      idExpiryDate: { not: null, lte: new Date(Date.now() + idWarnDays * 86400000) },
      ...personInScope,
    },
    include: { department: true, nationality: true },
    orderBy: { idExpiryDate: 'asc' },
  });

  // 6. 报修工单超期未完成
  const openWO = await prisma.workOrder.findMany({
    where: { status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] } },
    include: { category: true },
  });
  const workOrderOverdue = openWO
    .map((w) => ({
      id: w.id, code: w.code, title: w.title, category: w.category.nameZh,
      priority: w.priority, status: w.status, reportedAt: w.reportedAt,
      slaHours: w.category.slaHours,
      overdueHours: Math.round((Date.now() - w.reportedAt.getTime()) / 36e5 - w.category.slaHours),
      blocksOccupancy: w.blocksOccupancy,
    }))
    .filter((w) => w.overdueHours > 0)
    .sort((a, b) => b.overdueHours - a.overdueHours);

  // 7. 违规积分超阈值
  const vioGroups = await prisma.violation.groupBy({
    by: ['personId'],
    where: { status: { in: ['OPEN', 'HANDLED'] }, personId: { not: null } },
    _sum: { points: true, fine: true },
    _count: true,
  });
  const overThreshold = vioGroups.filter((g) => (g._sum.points ?? 0) >= pointsThreshold);
  const vioPersons = await prisma.person.findMany({
    where: { id: { in: overThreshold.map((g) => g.personId!) } },
    include: { department: true },
  });
  const vioMap = new Map(vioPersons.map((p) => [p.id, p]));
  const violationOverLimit = overThreshold.map((g) => ({
    personId: g.personId, name: vioMap.get(g.personId!)?.name,
    employeeNo: vioMap.get(g.personId!)?.employeeNo,
    department: vioMap.get(g.personId!)?.department?.nameZh ?? null,
    points: g._sum.points ?? 0, fine: g._sum.fine ?? 0, count: g._count, threshold: pointsThreshold,
  })).sort((a, b) => b.points - a.points);

  // 8. 房间超住：在住人数超过核定人数（加床、私自挤住都会体现在这里）
  const roomsAll = await prisma.room.findMany({
    where: roomScope,
    include: {
      roomType: true,
      floor: { include: { building: true } },
      beds: { include: { occupancies: { where: { status: { in: LIVE } } } } },
    },
  });
  const overCapacity = roomsAll
    .map((r) => ({
      roomId: r.id, roomCode: r.code, roomType: r.roomType.nameZh,
      building: r.floor.building.code, floorLevel: r.floor.level,
      capacity: r.capacity, nominal: r.roomType.defaultCapacity,
      occupants: r.beds.reduce((s, b) => s + b.occupancies.length, 0),
      deratedReason: r.deratedReason,
    }))
    .filter((r) => r.occupants > r.capacity);

  // 9. 功能房被占用（洗衣房 / 祷告室里住了人）
  const functionRoomOccupied = roomsAll
    .filter((r) => !r.roomType.isResidential && r.beds.some((b) => b.occupancies.length > 0))
    .map((r) => ({ roomId: r.id, roomCode: r.code, roomType: r.roomType.nameZh, building: r.floor.building.code }));

  // 10. 降标不一致：核定人数与可用床位对不上
  const deratedMismatch = roomsAll
    .filter((r) => r.roomType.isResidential)
    .map((r) => ({
      roomId: r.id, roomCode: r.code, roomType: r.roomType.nameZh,
      building: r.floor.building.code, capacity: r.capacity,
      usableBeds: r.beds.filter((b) => !OUT_OF_SERVICE.includes(b.status)).length,
      deratedReason: r.deratedReason,
    }))
    .filter((r) => r.usableBeds > r.capacity);

  // 11. 夫妻房异常：单人独占夫妻房，或配偶没住在一起
  const coupleRooms = roomsAll.filter((r) => r.roomType.isCoupleRoom);
  const coupleAnomalies: any[] = [];
  for (const r of coupleRooms) {
    const occs = r.beds.flatMap((b) => b.occupancies);
    if (occs.length === 1) {
      const p = await prisma.person.findUnique({ where: { id: occs[0].personId } });
      coupleAnomalies.push({
        roomId: r.id, roomCode: r.code, building: r.floor.building.code,
        issue: 'SINGLE_OCCUPANT', personId: p?.id, name: p?.name, employeeNo: p?.employeeNo,
        detail: '夫妻房被单人占用，配偶未入住或已离园',
      });
    }
  }
  // 已核验配偶但没住同一间房
  const spouseRels = await prisma.relationship.findMany({
    where: { type: 'SPOUSE', verified: true },
    include: {
      person: { include: { occupancies: { where: { status: { in: LIVE } }, include: { bed: true } } } },
      related: { include: { occupancies: { where: { status: { in: LIVE } }, include: { bed: true } } } },
    },
  });
  for (const rel of spouseRels) {
    const a = rel.person.occupancies[0];
    const b = rel.related.occupancies[0];
    if (a && b && a.bed.roomId !== b.bed.roomId) {
      coupleAnomalies.push({
        issue: 'SPOUSES_APART', personId: rel.person.id, name: rel.person.name,
        employeeNo: rel.person.employeeNo, spouseName: rel.related.name,
        detail: '已登记配偶但分住两间房，可考虑安排夫妻房',
      });
    }
  }

  // 12. 家属没跟挂靠员工同房
  const dependents = await prisma.person.findMany({
    where: { personType: 'DEPENDENT', hostPersonId: { not: null }, ...personInScope },
    include: {
      occupancies: { where: { status: { in: LIVE } }, include: { bed: { include: { room: true } } } },
      hostPerson: { include: { occupancies: { where: { status: { in: LIVE } }, include: { bed: true } } } },
    },
  });
  const dependentApart = dependents
    .filter((d) => {
      const dOcc = d.occupancies[0];
      const hOcc = d.hostPerson?.occupancies[0];
      if (!dOcc) return false;
      return !hOcc || hOcc.bed.roomId !== dOcc.bed.roomId;
    })
    .map((d) => ({
      personId: d.id, name: d.name, employeeNo: d.employeeNo,
      hostName: d.hostPerson?.name, roomCode: d.occupancies[0]?.bed.room.code,
      detail: '家属未与挂靠员工住同一房间',
    }));

  // 13. 访客超期未离开
  const visitorOverstay = (await prisma.visitor.findMany({
    where: { status: 'IN', expectedOutAt: { not: null, lt: new Date() } },
    include: { hostPerson: true },
  })).map((v) => ({
    id: v.id, code: v.code, name: v.name, host: v.hostPerson.name,
    expectedOutAt: v.expectedOutAt, overnight: v.overnight,
    overdueDays: Math.round((Date.now() - v.expectedOutAt!.getTime()) / 86400000),
  }));

  // 14. 待审批申请堆积
  const pendingRequests = (await prisma.request.findMany({
    where: { status: 'PENDING' },
    include: { person: true },
    orderBy: { submittedAt: 'asc' },
  })).map((r) => ({
    id: r.id, code: r.code, type: r.type, name: r.person.name, employeeNo: r.person.employeeNo,
    reason: r.reason, submittedAt: r.submittedAt,
    waitingDays: Math.round((Date.now() - r.submittedAt.getTime()) / 86400000),
  }));

  // 15. 未归还物品（人已退宿但物品没清）
  const itemsNotReturned = (await prisma.issuedItem.findMany({
    where: {
      returnedAt: null,
      itemType: { isReturnable: true },
      person: { occupancies: { none: { status: { in: LIVE } } } },
    },
    include: { person: true, itemType: true },
    take: 200,
  })).map((i) => ({
    id: i.id, personId: i.personId, name: i.person.name, employeeNo: i.person.employeeNo,
    item: i.itemType.nameZh, quantity: i.quantity, price: i.itemType.price, issuedAt: i.issuedAt,
  }));

  return {
    thresholds: { warningDays, idWarnDays, staleDays, pointsThreshold },
    resignedStillHoused: resignedRows.map((o) => ({
      occupancyId: o.id, personId: o.personId, employeeNo: o.person.employeeNo,
      name: o.person.name, department: o.person.department?.nameZh ?? null,
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
    idExpiring: idExpiring.map((p) => ({
      personId: p.id, name: p.name, employeeNo: p.employeeNo,
      department: p.department?.nameZh ?? null, nationalityId: p.nationalityId,
      idType: p.idType, idNumber: p.idNumber, idExpiryDate: p.idExpiryDate,
      inDays: Math.round((p.idExpiryDate!.getTime() - Date.now()) / 86400000),
      passportHeld: p.passportHeld,
    })),
    workOrderOverdue,
    violationOverLimit,
    overCapacity,
    functionRoomOccupied,
    deratedMismatch,
    coupleAnomalies,
    dependentApart,
    visitorOverstay,
    pendingRequests,
    itemsNotReturned,
  };
}
