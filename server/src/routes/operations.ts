import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { nextCode } from '../services/space.js';
import { requirePerm, actor, audit } from '../services/auth.js';
import { notify } from '../services/notify.js';

/**
 * 日常运营模块：报修工单 / 违规记录 / 访客登记 / 查寝检查 /
 * 物品发放归还 / 押金 / 申请审批 / 公告
 */

const scopeLabel = async (scopeType: string, scopeId: number) => {
  if (scopeType === 'ROOM') {
    const r = await prisma.room.findUnique({
      where: { id: scopeId },
      include: { floor: { include: { building: true } } },
    });
    return r ? `${r.floor.building.code}栋 ${r.floor.level}层 ${r.code}` : `房间#${scopeId}`;
  }
  if (scopeType === 'FLOOR') {
    const f = await prisma.floor.findUnique({ where: { id: scopeId }, include: { building: true } });
    return f ? `${f.building.code}栋 ${f.level}层` : `楼层#${scopeId}`;
  }
  if (scopeType === 'BUILDING') {
    const b = await prisma.building.findUnique({ where: { id: scopeId } });
    return b ? `${b.code}栋` : `楼栋#${scopeId}`;
  }
  return '公共区域';
};

export default async function operationRoutes(app: FastifyInstance) {
  // ==================================================== 报修工单
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/workorders', async (req) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Math.min(Number(req.query.pageSize ?? 20), 200);
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.priority) where.priority = req.query.priority;
    if (req.query.categoryId) where.categoryId = Number(req.query.categoryId);
    if (req.query.open === 'true') where.status = { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] };
    if (req.query.q) where.OR = [{ code: { contains: req.query.q } }, { title: { contains: req.query.q } }];

    const [total, rows] = await Promise.all([
      prisma.workOrder.count({ where }),
      prisma.workOrder.findMany({
        where, include: { category: true, reportedBy: { select: { id: true, name: true, employeeNo: true } } },
        orderBy: [{ status: 'asc' }, { reportedAt: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);

    const enriched = await Promise.all(rows.map(async (w) => {
      const deadline = new Date(w.reportedAt.getTime() + w.category.slaHours * 3600000);
      const done = ['DONE', 'CLOSED', 'REJECTED'].includes(w.status);
      return {
        id: w.id, code: w.code, title: w.title, description: w.description,
        category: w.category.nameZh, categoryId: w.categoryId, slaHours: w.category.slaHours,
        priority: w.priority, status: w.status,
        scopeType: w.scopeType, scopeId: w.scopeId, location: await scopeLabel(w.scopeType, w.scopeId),
        reportedAt: w.reportedAt, reporter: w.reportedBy?.name ?? w.reporterName,
        assignedTo: w.assignedTo, startedAt: w.startedAt, finishedAt: w.finishedAt,
        cost: w.cost, blocksOccupancy: w.blocksOccupancy, rating: w.rating,
        deadline,
        overdue: !done && Date.now() > deadline.getTime(),
        hoursUsed: w.finishedAt ? Math.round((w.finishedAt.getTime() - w.reportedAt.getTime()) / 36e5) : null,
      };
    }));
    return { total, page, pageSize, rows: enriched };
  });

  app.post<{ Body: Record<string, any> }>('/api/workorders',
    { preHandler: requirePerm('workorder:write') },
    async (req) => {
    const b = req.body;
    const cat = await prisma.workOrderCategory.findUnique({ where: { id: Number(b.categoryId) } });
    const wo = await prisma.workOrder.create({
      data: {
        code: await nextCode('WO', 'workOrder'),
        categoryId: Number(b.categoryId),
        priority: b.priority ?? 'NORMAL',
        title: b.title, description: b.description,
        scopeType: b.scopeType ?? 'ROOM', scopeId: Number(b.scopeId),
        reportedById: b.reportedById ? Number(b.reportedById) : null,
        reporterName: b.reporterName ?? '宿管代报',
        blocksOccupancy: b.blocksOccupancy ?? cat?.blocksByDefault ?? false,
      },
    });
    // 紧急或影响住宿的工单，直接推给宿管，不等他们自己刷新页面
    if (wo.priority === 'URGENT' || wo.blocksOccupancy) {
      await notify('WORKORDER_ASSIGNED', { roleCode: 'WARDEN' }, {
        code: wo.code, category: cat?.nameZh ?? '', location: await scopeLabel(wo.scopeType, wo.scopeId),
        title: wo.title, sla: cat?.slaHours ?? 48,
      }, { type: 'WORKORDER', id: wo.id, linkPath: '/workorders' });
    }
    // 影响住宿的工单直接把房间置为维修，避免继续往里排人
    if (wo.blocksOccupancy && wo.scopeType === 'ROOM') {
      await prisma.room.update({ where: { id: wo.scopeId }, data: { status: 'MAINTENANCE', note: `工单 ${wo.code}` } });
    }
    return wo;
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/workorders/:id',
    { preHandler: requirePerm('workorder:write') },
    async (req) => {
    const id = Number(req.params.id);
    const b = req.body;
    const data: any = {};
    for (const k of ['priority', 'title', 'description', 'assignedTo', 'cost', 'materials', 'rating', 'note', 'blocksOccupancy']) {
      if (k in b) data[k] = b[k];
    }
    if (b.status) {
      data.status = b.status;
      if (b.status === 'IN_PROGRESS') data.startedAt = new Date();
      if (b.status === 'DONE') data.finishedAt = new Date();
      if (b.status === 'CLOSED') { data.closedAt = new Date(); data.finishedAt = data.finishedAt ?? new Date(); }
    }
    const wo = await prisma.workOrder.update({ where: { id }, data, include: { category: true } });
    // 完成时告诉报修人一声 —— 不然他不知道修好了没
    if (wo.status === 'DONE' && wo.reportedById) {
      await notify('WORKORDER_DONE', { personId: wo.reportedById },
        { code: wo.code, title: wo.title },
        { type: 'WORKORDER', id: wo.id, linkPath: '/workorders' });
    }
    // 工单关闭且原本封了房间 → 自动恢复可用
    if (['DONE', 'CLOSED'].includes(wo.status) && wo.blocksOccupancy && wo.scopeType === 'ROOM') {
      const others = await prisma.workOrder.count({
        where: { scopeType: 'ROOM', scopeId: wo.scopeId, blocksOccupancy: true, status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] } },
      });
      if (others === 0) {
        await prisma.room.update({ where: { id: wo.scopeId }, data: { status: 'CLEANING', note: '维修完成，待清洁' } });
      }
    }
    return wo;
  });

  // ==================================================== 违规记录
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/violations', async (req) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Math.min(Number(req.query.pageSize ?? 20), 200);
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.typeId) where.typeId = Number(req.query.typeId);
    if (req.query.severity) where.type = { severity: req.query.severity };
    if (req.query.personId) where.personId = Number(req.query.personId);
    if (req.query.buildingId) where.room = { floor: { buildingId: Number(req.query.buildingId) } };

    const [total, rows] = await Promise.all([
      prisma.violation.count({ where }),
      prisma.violation.findMany({
        where,
        include: {
          type: true,
          person: { include: { department: true, nationality: true } },
          room: { include: { floor: { include: { building: true } } } },
        },
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    return {
      total, page, pageSize,
      rows: rows.map((v) => ({
        id: v.id, code: v.code, occurredAt: v.occurredAt,
        type: v.type.nameZh, typeCode: v.type.code, severity: v.type.severity,
        points: v.points, fine: v.fine, action: v.action, status: v.status,
        description: v.description, recordedBy: v.recordedBy, handledAt: v.handledAt,
        person: v.person ? {
          id: v.person.id, name: v.person.name, employeeNo: v.person.employeeNo,
          department: v.person.department?.nameZh ?? null,
          nationalityId: v.person.nationalityId, nationalityColor: v.person.nationality.color,
        } : null,
        location: v.room ? `${v.room.floor.building.code}栋 ${v.room.code}` : null,
        roomId: v.roomId,
      })),
    };
  });

  app.post<{ Body: Record<string, any> }>('/api/violations', { preHandler: requirePerm('violation:create') }, async (req) => {
    const b = req.body;
    const t = await prisma.violationType.findUnique({ where: { id: Number(b.typeId) } });
    const created = await prisma.violation.create({
      data: {
        code: await nextCode('VIO', 'violation'),
        personId: b.personId ? Number(b.personId) : null,
        roomId: b.roomId ? Number(b.roomId) : null,
        typeId: Number(b.typeId),
        occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
        points: b.points ?? t?.defaultPoints ?? 1,
        fine: b.fine ?? t?.defaultFine ?? 0,
        description: b.description, evidence: b.evidence,
        recordedBy: b.recordedBy ?? actor(req),
        action: b.action ?? (t && ['CRITICAL', 'HIGH'].includes(t.severity) ? 'FINE' : 'WARNING'),
      },
    });
    if (created.personId) {
      await notify('VIOLATION_RECORDED', { personId: created.personId }, {
        type: t?.nameZh ?? '', points: created.points,
        fine: created.fine ? `、罚款 ¥${created.fine}` : '',
      }, { type: 'VIOLATION', id: created.id, linkPath: '/violations' });
    }
    await audit(req, 'VIOLATION_CREATE', { targetType: 'Violation', targetId: created.id, detail: t?.nameZh });
    return created;
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/violations/:id',
    { preHandler: requirePerm('violation:write') },
    async (req) => {
    const data: any = { ...req.body };
    if (data.status === 'HANDLED' && !data.handledAt) data.handledAt = new Date();
    return prisma.violation.update({ where: { id: Number(req.params.id) }, data });
  });

  /** 违规积分排行 —— 超过阈值要处理 */
  app.get('/api/violations/ranking', async () => {
    const rows = await prisma.violation.groupBy({
      by: ['personId'],
      where: { status: { not: 'CLOSED' }, personId: { not: null } },
      _sum: { points: true, fine: true },
      _count: true,
    });
    const sorted = rows
      .filter((r) => r.personId !== null)
      .sort((a, b) => (b._sum.points ?? 0) - (a._sum.points ?? 0))
      .slice(0, 50);
    const persons = await prisma.person.findMany({
      where: { id: { in: sorted.map((s) => s.personId!) } },
      include: { department: true, nationality: true, occupancies: { where: { status: { in: ['ACTIVE', 'HELD'] } }, include: { bed: { include: { room: true } } } } },
    });
    const pm = new Map(persons.map((p) => [p.id, p]));
    return sorted.map((s) => {
      const p = pm.get(s.personId!);
      return {
        personId: s.personId, name: p?.name, employeeNo: p?.employeeNo,
        department: p?.department?.nameZh ?? null, nationalityId: p?.nationalityId,
        roomCode: p?.occupancies[0]?.bed.room.code ?? null,
        count: s._count, points: s._sum.points ?? 0, fine: s._sum.fine ?? 0,
      };
    });
  });

  // ==================================================== 访客
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/visitors', async (req) => {
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.overnight === 'true') where.overnight = true;
    if (req.query.q) where.OR = [{ name: { contains: req.query.q } }, { code: { contains: req.query.q } }];
    const rows = await prisma.visitor.findMany({
      where,
      include: {
        hostPerson: { include: { department: true } },
        room: { include: { floor: { include: { building: true } } } },
      },
      orderBy: { checkInAt: 'desc' }, take: 200,
    });
    return rows.map((v) => ({
      id: v.id, code: v.code, name: v.name, idNumber: v.idNumber, phone: v.phone,
      nationalityId: v.nationalityId, purpose: v.purpose, overnight: v.overnight, status: v.status,
      checkInAt: v.checkInAt, expectedOutAt: v.expectedOutAt, checkOutAt: v.checkOutAt,
      approvedBy: v.approvedBy, registeredBy: v.registeredBy,
      host: { id: v.hostPerson.id, name: v.hostPerson.name, employeeNo: v.hostPerson.employeeNo,
              department: v.hostPerson.department?.nameZh ?? null },
      location: v.room ? `${v.room.floor.building.code}栋 ${v.room.code}` : null,
      overstay: !v.checkOutAt && v.expectedOutAt ? Date.now() > v.expectedOutAt.getTime() : false,
    }));
  });

  app.post<{ Body: Record<string, any> }>('/api/visitors',
    { preHandler: requirePerm('visitor:write') },
    async (req) => {
    const b = req.body;
    return prisma.visitor.create({
      data: {
        code: await nextCode('V', 'visitor'),
        name: b.name, idNumber: b.idNumber, phone: b.phone, nationalityId: b.nationalityId,
        hostPersonId: Number(b.hostPersonId), roomId: b.roomId ? Number(b.roomId) : null,
        purpose: b.purpose, overnight: !!b.overnight,
        expectedOutAt: b.expectedOutAt ? new Date(b.expectedOutAt) : null,
        // 留宿必须审批；不留宿的直接放行
        status: b.overnight ? 'PENDING' : 'IN',
        registeredBy: b.registeredBy ?? '门岗',
        note: b.note,
      },
    });
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/visitors/:id',
    { preHandler: requirePerm('visitor:write') },
    async (req) => {
    const data: any = { ...req.body };
    if (data.status === 'OUT' && !data.checkOutAt) data.checkOutAt = new Date();
    if (data.expectedOutAt) data.expectedOutAt = new Date(data.expectedOutAt);
    return prisma.visitor.update({ where: { id: Number(req.params.id) }, data });
  });

  // ==================================================== 查寝 / 检查
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/inspections', async (req) => {
    const where: any = {};
    if (req.query.type) where.type = req.query.type;
    if (req.query.status) where.status = req.query.status;
    const rows = await prisma.inspection.findMany({
      where, orderBy: { plannedAt: 'desc' }, take: 100,
      include: { items: { select: { id: true, present: true, score: true, issues: true } } },
    });
    return Promise.all(rows.map(async (i) => {
      const items = i.items;
      const roll = items.filter((x) => x.present !== null);
      return {
        id: i.id, code: i.code, type: i.type, status: i.status,
        plannedAt: i.plannedAt, executedAt: i.executedAt, inspector: i.inspector,
        score: i.score, summary: i.summary,
        location: await scopeLabel(i.scopeType, i.scopeId),
        scopeType: i.scopeType, scopeId: i.scopeId,
        itemCount: items.length,
        presentCount: roll.filter((x) => x.present).length,
        absentCount: roll.filter((x) => x.present === false).length,
        issueCount: items.filter((x) => x.issues).length,
      };
    }));
  });

  app.get<{ Params: { id: string } }>('/api/inspections/:id', async (req, reply) => {
    const ins = await prisma.inspection.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        items: {
          include: {
            room: true,
            person: { include: { department: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!ins) return reply.code(404).send({ error: 'not found' });
    return {
      ...ins,
      location: await scopeLabel(ins.scopeType, ins.scopeId),
      items: ins.items.map((it) => ({
        id: it.id, roomCode: it.room.code, score: it.score, issues: it.issues, present: it.present,
        person: it.person ? { id: it.person.id, name: it.person.name, employeeNo: it.person.employeeNo,
                              department: it.person.department?.nameZh ?? null } : null,
      })),
    };
  });

  /** 发起一次查寝：自动把该楼层当前在住的人拉成点名清单 */
  app.post<{ Body: { type: string; scopeType: string; scopeId: number; inspector?: string; plannedAt?: string } }>(
    '/api/inspections',
    { preHandler: requirePerm('inspection:write') },
    async (req) => {
      const { type, scopeType, scopeId, inspector, plannedAt } = req.body;
      const ins = await prisma.inspection.create({
        data: {
          code: await nextCode('INS', 'inspection'),
          type, scopeType, scopeId, inspector: inspector ?? 'admin',
          plannedAt: plannedAt ? new Date(plannedAt) : new Date(),
          status: 'DOING',
        },
      });
      const rooms = await prisma.room.findMany({
        where: scopeType === 'FLOOR' ? { floorId: scopeId } : { floor: { buildingId: scopeId } },
        include: {
          roomType: true,
          beds: { include: { occupancies: { where: { status: { in: ['ACTIVE', 'HELD'] } } } } },
        },
      });
      const items: any[] = [];
      for (const r of rooms) {
        if (!r.roomType.isResidential) continue;
        if (type === 'NIGHT_ROLL_CALL') {
          for (const b of r.beds) {
            const occ = b.occupancies[0];
            if (occ) items.push({ inspectionId: ins.id, roomId: r.id, personId: occ.personId, present: null });
          }
        } else {
          items.push({ inspectionId: ins.id, roomId: r.id });
        }
      }
      if (items.length) await prisma.inspectionItem.createMany({ data: items });
      return { ...ins, itemCount: items.length };
    }
  );

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/inspection-items/:id',
    { preHandler: requirePerm('inspection:write') },
    async (req) =>
    prisma.inspectionItem.update({ where: { id: Number(req.params.id) }, data: req.body })
  );

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/inspections/:id',
    { preHandler: requirePerm('inspection:write') },
    async (req) => {
    const data: any = { ...req.body };
    if (data.status === 'DONE' && !data.executedAt) data.executedAt = new Date();
    return prisma.inspection.update({ where: { id: Number(req.params.id) }, data });
  });

  // ==================================================== 物品 / 押金
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/issued-items', async (req) => {
    const where: any = {};
    if (req.query.personId) where.personId = Number(req.query.personId);
    if (req.query.pending === 'true') where.returnedAt = null;
    const rows = await prisma.issuedItem.findMany({
      where, include: { itemType: true, person: { select: { id: true, name: true, employeeNo: true } } },
      orderBy: { issuedAt: 'desc' }, take: 500,
    });
    return rows.map((i) => ({
      id: i.id, person: i.person, itemName: i.itemType.nameZh, itemCode: i.itemType.code,
      quantity: i.quantity, issuedAt: i.issuedAt, returnedAt: i.returnedAt,
      condition: i.condition, compensation: i.compensation,
      price: i.itemType.price, deposit: i.itemType.deposit, isReturnable: i.itemType.isReturnable,
    }));
  });

  app.post<{ Body: { personId: number; itemTypeId: number; quantity?: number; bedId?: number; occupancyId?: number; issuedBy?: string } }>(
    '/api/issued-items',
    { preHandler: requirePerm('item:write') },
    async (req) => prisma.issuedItem.create({ data: { ...req.body, quantity: req.body.quantity ?? 1 } })
  );

  /** 归还 / 报损。损坏或遗失自动按单价算赔偿 */
  app.put<{ Params: { id: string }; Body: { condition?: string; compensation?: number; returnedBy?: string } }>(
    '/api/issued-items/:id/return',
    { preHandler: requirePerm('item:write') },
    async (req) => {
      const id = Number(req.params.id);
      const item = await prisma.issuedItem.findUnique({ where: { id }, include: { itemType: true } });
      const cond = req.body.condition ?? 'GOOD';
      const comp = req.body.compensation ??
        (cond === 'LOST' ? (item?.itemType.price ?? 0) * (item?.quantity ?? 1)
          : cond === 'DAMAGED' ? Math.round((item?.itemType.price ?? 0) * 0.5) : 0);
      return prisma.issuedItem.update({
        where: { id },
        data: { returnedAt: new Date(), returnedBy: req.body.returnedBy ?? 'admin', condition: cond, compensation: comp },
      });
    }
  );

  app.get<{ Querystring: { personId?: string } }>('/api/deposits', async (req) => {
    const where: any = {};
    if (req.query.personId) where.personId = Number(req.query.personId);
    return prisma.deposit.findMany({
      where, include: { person: { select: { id: true, name: true, employeeNo: true } } },
      orderBy: { paidAt: 'desc' }, take: 300,
    });
  });

  // ==================================================== 申请审批
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/requests', async (req) => {
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.type) where.type = req.query.type;
    const rows = await prisma.request.findMany({
      where,
      include: {
        person: {
          include: {
            department: true, positionLevel: true, nationality: true,
            occupancies: { where: { status: { in: ['ACTIVE', 'HELD'] } }, include: { bed: { include: { room: true } } } },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }], take: 200,
    });
    return rows.map((r) => ({
      id: r.id, code: r.code, type: r.type, status: r.status, reason: r.reason,
      submittedBy: r.submittedBy, submittedAt: r.submittedAt,
      approvedBy: r.approvedBy, approvedAt: r.approvedAt, comment: r.comment,
      targetRoomId: r.targetRoomId, targetBedId: r.targetBedId,
      person: {
        id: r.person.id, name: r.person.name, employeeNo: r.person.employeeNo,
        department: r.person.department?.nameZh ?? null,
        positionLevel: r.person.positionLevel?.nameZh ?? null,
        nationalityId: r.person.nationalityId, nationalityColor: r.person.nationality.color,
        currentRoom: r.person.occupancies[0]?.bed.room.code ?? null,
      },
    }));
  });

  app.post<{ Body: Record<string, any> }>('/api/requests',
    { preHandler: requirePerm('request:read') },
    async (req) => {
    const b = req.body;
    return prisma.request.create({
      data: {
        code: await nextCode('REQ', 'request'),
        type: b.type, personId: Number(b.personId),
        targetRoomId: b.targetRoomId ? Number(b.targetRoomId) : null,
        targetBedId: b.targetBedId ? Number(b.targetBedId) : null,
        reason: b.reason, submittedBy: b.submittedBy ?? 'admin',
      },
    });
  });

  app.put<{ Params: { id: string }; Body: { status: string; comment?: string; approvedBy?: string } }>(
    '/api/requests/:id',
    { preHandler: requirePerm('request:write') },
    async (req) => {
      const updated = await prisma.request.update({
        where: { id: Number(req.params.id) },
        data: {
          status: req.body.status,
          comment: req.body.comment,
          approvedBy: req.body.approvedBy ?? actor(req),
          approvedAt: new Date(),
        },
      });
      const TYPE_ZH: Record<string, string> = {
        CHECKIN: '入住申请', TRANSFER: '调宿申请', CHECKOUT: '退宿申请',
        COUPLE_ROOM: '夫妻房申请', VISITOR_OVERNIGHT: '访客留宿', EXTRA_BED: '加床申请',
      };
      if (updated.status === 'APPROVED' || updated.status === 'REJECTED') {
        await notify(updated.status === 'APPROVED' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED',
          { personId: updated.personId },
          { code: updated.code, type: TYPE_ZH[updated.type] ?? updated.type, comment: updated.comment ?? '—' },
          { type: 'REQUEST', id: updated.id, linkPath: '/requests' });
      }
      await audit(req, `REQUEST_${updated.status}`, { targetType: 'Request', targetId: updated.id, detail: updated.code });
      return updated;
    }
  );

  // ==================================================== 公告
  app.get<{ Querystring: { active?: string } }>('/api/announcements', async (req) => {
    const where: any = {};
    if (req.query.active === 'true') {
      where.isActive = true;
      where.OR = [{ expiresAt: null }, { expiresAt: { gte: new Date() } }];
    }
    return prisma.announcement.findMany({ where, orderBy: { publishedAt: 'desc' }, take: 100 });
  });

  app.post<{ Body: Record<string, any> }>('/api/announcements',
    { preHandler: requirePerm('config:write') },
    async (req) => {
    const b = { ...req.body };
    if (b.expiresAt) b.expiresAt = new Date(b.expiresAt);
    return prisma.announcement.create({ data: { ...b, publishedBy: b.publishedBy ?? 'admin' } as any });
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/announcements/:id',
    { preHandler: requirePerm('config:write') },
    async (req) => {
    const b = { ...req.body };
    if (b.expiresAt) b.expiresAt = new Date(b.expiresAt);
    return prisma.announcement.update({ where: { id: Number(req.params.id) }, data: b });
  });
}
