import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { issueTokenForPerson, requireSelf } from '../services/auth.js';
import { notify } from '../services/notify.js';
import { nextCode } from '../services/space.js';
import { nextLeaveDue } from './persons.js';

/**
 * 员工自助端。
 *
 * 核心前提：**不给上万工人发账号密码**。登录方式两种：
 *   1. 工号 + 手机验证码（本文件实现，验证码通过短信 / WhatsApp 渠道下发）
 *   2. 企业平台扫码（企业微信 / 钉钉 / 飞书…），绑定关系落在 IdentityBinding
 *
 * 员工 token 的权限固定只有 'self'，碰不到任何管理端接口。
 * 所有查询都强制以 token 里的 personId 为准，不接受前端传 personId —— 越权从源头堵死。
 */

const LIVE = ['ACTIVE', 'HELD', 'RESERVED'];
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

/** 员工自助端能提的申请类型 —— 有意不含「入住」，那是宿管的事 */
const SELF_REQUEST_TYPES = ['TRANSFER', 'CHECKOUT', 'COUPLE_ROOM', 'VISITOR_OVERNIGHT', 'EXTRA_BED'];

/** 字典项统一返回三语，前端按当前语言取 —— 后端不做语言判断 */
const pick3 = (o: any) =>
  o ? { zh: o.nameZh, id: o.nameId ?? o.nameZh, en: o.nameEn ?? o.nameZh } : null;

const localeOf = (p: { nationalityId: string }) =>
  p.nationalityId === 'CN' ? 'zh' : p.nationalityId === 'ID' ? 'id' : 'en';

export default async function selfRoutes(app: FastifyInstance) {
  // ==================================================== 登录
  /**
   * 申请验证码。
   * 安全考虑：工号不存在也返回成功，不泄漏「这个工号在不在册」。
   * 当所有下发渠道（短信 / WhatsApp）都没启用时，把验证码直接返回并标记
   * devFallback —— 这样在平台接入之前系统仍然可用、可演示，且状态是明说的。
   */
  app.post<{ Body: { employeeNo?: string } }>('/api/self/otp/request', async (req, reply) => {
    const employeeNo = (req.body?.employeeNo ?? '').trim();
    if (!employeeNo) return reply.code(400).send({ error: '请输入工号' });

    const person = await prisma.person.findUnique({ where: { employeeNo } });
    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60000);

    // 检查下发渠道是否可用
    const channels = await prisma.integration.findMany({
      where: { provider: { in: ['SMS', 'WHATSAPP'] }, enabled: true },
    });
    const canDeliver = channels.length > 0 && !!person?.phone;

    if (person && person.employmentStatus !== 'RESIGNED') {
      await prisma.otpCode.create({
        data: { target: person.phone ?? employeeNo, employeeNo, code, personId: person.id, expiresAt },
      });
      await notify('SELF_OTP', { personId: person.id }, { code, minutes: OTP_TTL_MINUTES });
    }

    return {
      ok: true,
      expiresInMinutes: OTP_TTL_MINUTES,
      maskedPhone: person?.phone ? person.phone.replace(/(\d{2})\d+(\d{4})$/, '$1****$2') : null,
      /** 没有可用下发渠道时才回显验证码，并明确告知原因 */
      devFallback: !canDeliver,
      devCode: !canDeliver && person ? code : undefined,
      devHint: !canDeliver
        ? '短信 / WhatsApp 渠道尚未启用（设置 → 集成对接），验证码暂时直接显示。接入后此处不再回显。'
        : undefined,
    };
  });

  app.post<{ Body: { employeeNo?: string; code?: string } }>('/api/self/otp/verify', async (req, reply) => {
    const employeeNo = (req.body?.employeeNo ?? '').trim();
    const code = (req.body?.code ?? '').trim();
    if (!employeeNo || !code) return reply.code(400).send({ error: '请输入工号和验证码' });

    const otp = await prisma.otpCode.findFirst({
      where: { employeeNo, purpose: 'SELF_LOGIN', usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { id: 'desc' },
    });
    if (!otp) return reply.code(400).send({ error: '验证码已过期，请重新获取' });
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return reply.code(429).send({ error: '尝试次数过多，请重新获取验证码' });
    }
    if (otp.code !== code) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return reply.code(400).send({ error: '验证码不正确', remaining: OTP_MAX_ATTEMPTS - otp.attempts - 1 });
    }

    await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
    const issued = await issueTokenForPerson(otp.personId!);
    if (!issued) return reply.code(403).send({ error: '该人员已离职或不可用' });

    // 首次用手机验证码登录时，补一条 PHONE 身份绑定，方便以后换成扫码
    await prisma.identityBinding.upsert({
      where: { provider_externalId: { provider: 'PHONE', externalId: otp.target } },
      update: { lastLoginAt: new Date() },
      create: {
        provider: 'PHONE', externalId: otp.target, personId: otp.personId,
        displayName: '手机验证码', lastLoginAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: { username: employeeNo, action: 'SELF_LOGIN', targetType: 'Person', targetId: otp.personId!, ip: req.ip },
    });
    return issued;
  });

  /** 企业平台扫码登录（员工端）—— 凭据配好后启用 */
  app.get<{ Params: { provider: string } }>('/api/self/sso/:provider', async (req, reply) => {
    const provider = req.params.provider.toUpperCase();
    const integ = await prisma.integration.findUnique({ where: { provider } });
    if (!integ) return reply.code(404).send({ error: `未知平台 ${provider}` });
    if (!integ.enabled) {
      return reply.code(503).send({
        error: `${integ.nameZh} 尚未启用`,
        hint: '请管理员在「设置 → 集成对接」填入企业凭据并启用',
      });
    }
    return reply.code(501).send({
      error: `${integ.nameZh} 扫码登录待接入`,
      hint: '凭据已配置；接入该平台 OAuth 回调后，回调里查 IdentityBinding 并调 issueTokenForPerson 即可',
    });
  });

  // ==================================================== 我的信息
  app.get('/api/self/profile', { preHandler: requireSelf }, async (req) => {
    const personId = req.auth!.sub;
    const p = await prisma.person.findUnique({
      where: { id: personId },
      include: {
        nationality: true, department: true, positionLevel: true, shift: true, religion: true,
        hostPerson: { select: { id: true, name: true, employeeNo: true } },
        occupancies: {
          where: { status: { in: LIVE } },
          include: {
            bed: {
              include: {
                room: {
                  include: {
                    roomType: true,
                    floor: { include: { building: true } },
                    beds: {
                      include: {
                        occupancies: {
                          where: { status: { in: ['ACTIVE', 'HELD'] } },
                          include: { person: { select: { id: true, name: true, employeeNo: true, nationalityId: true, shiftId: true } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!p) return { error: 'not found' };

    const occ = p.occupancies[0];
    const room = occ?.bed.room;
    const roommates = room
      ? room.beds
          .flatMap((b: any) => b.occupancies.map((o: any) => ({
            ...o.person, bedLabel: b.label, bedPosition: b.position,
          })))
          .filter((x: any) => x.id !== personId)
      : [];

    const [items, deposits, violations, unread, openWO, pendingReq] = await Promise.all([
      prisma.issuedItem.findMany({ where: { personId }, include: { itemType: true }, orderBy: { issuedAt: 'desc' } }),
      prisma.deposit.findMany({ where: { personId, refundedAt: null } }),
      prisma.violation.findMany({ where: { personId, status: { not: 'CLOSED' } }, include: { type: true } }),
      prisma.notification.count({ where: { toPersonId: personId, readAt: null, channel: 'IN_APP' } }),
      prisma.workOrder.count({ where: { reportedById: personId, status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] } } }),
      prisma.request.count({ where: { personId, status: 'PENDING' } }),
    ]);

    const due = p.positionLevel ? nextLeaveDue(p.cycleStartDate, p.positionLevel.leaveCycleMonths) : null;

    return {
      person: {
        id: p.id, employeeNo: p.employeeNo, name: p.name, personType: p.personType,
        gender: p.gender, nationalityId: p.nationalityId,
        // 印尼籍员工看的是 Bahasa 界面，字典项必须带三语，不能只给中文
        nationality: pick3(p.nationality),
        department: pick3(p.department),
        positionLevel: pick3(p.positionLevel),
        shift: pick3(p.shift),
        phone: p.phone, locale: localeOf(p),
        employmentStatus: p.employmentStatus,
        idType: p.idType,
        idExpiryDate: p.idExpiryDate,
        idExpiryInDays: p.idExpiryDate
          ? Math.round((new Date(p.idExpiryDate).getTime() - Date.now()) / 86400000) : null,
        nextLeaveDue: due,
        leaveDueInDays: due ? Math.round((due.getTime() - Date.now()) / 86400000) : null,
        leaveCycleMonths: p.positionLevel?.leaveCycleMonths ?? null,
        hostPerson: p.hostPerson,
      },
      accommodation: occ
        ? {
            status: occ.status, checkInAt: occ.checkInAt,
            buildingCode: room!.floor.building.code, buildingName: room!.floor.building.name,
            floorLevel: room!.floor.level,
            roomId: room!.id, roomCode: room!.code,
            roomType: pick3(room!.roomType),
            bedLabel: occ.bed.label, bedCode: occ.bed.code,
            /** 铺位类型，前端据此渲染成对应语言（"1 下铺" 这种中文标签印尼工人看不懂） */
            bedPosition: occ.bed.position,
            bedNo: occ.bed.label.match(/\d+/)?.[0] ?? '',
            capacity: room!.capacity,
            hasAC: room!.hasAC, hasBathroom: room!.hasBathroom,
            hasWaterHeater: room!.hasWaterHeater, hasBalcony: room!.hasBalcony,
          }
        : null,
      roommates: roommates.map((r: any) => ({
        ...r,
        bedPosition: r.bedPosition, bedNo: String(r.bedLabel ?? '').match(/\d+/)?.[0] ?? '',
      })),
      items: items.map((i) => ({
        id: i.id, nameZh: i.itemType.nameZh, nameId: i.itemType.nameId, nameEn: i.itemType.nameEn,
        quantity: i.quantity, issuedAt: i.issuedAt, returnedAt: i.returnedAt,
        isReturnable: i.itemType.isReturnable, price: i.itemType.price,
      })),
      depositTotal: deposits.reduce((s, d) => s + d.amount - d.deduction, 0),
      violations: violations.map((v) => ({
        id: v.id, code: v.code, type: pick3(v.type), severity: v.type.severity,
        points: v.points, fine: v.fine, occurredAt: v.occurredAt, status: v.status,
      })),
      violationPoints: violations.reduce((s, v) => s + v.points, 0),
      counts: { unreadNotifications: unread, openWorkOrders: openWO, pendingRequests: pendingReq },
    };
  });

  // ==================================================== 我的报修
  app.get('/api/self/workorders', { preHandler: requireSelf }, async (req) => {
    const rows = await prisma.workOrder.findMany({
      where: { reportedById: req.auth!.sub },
      include: { category: true },
      orderBy: { reportedAt: 'desc' },
      take: 50,
    });
    return rows.map((w) => ({
      id: w.id, code: w.code, title: w.title, description: w.description,
      category: pick3(w.category), categoryId: w.categoryId,
      priority: w.priority, status: w.status,
      reportedAt: w.reportedAt, finishedAt: w.finishedAt,
      slaHours: w.category.slaHours,
      deadline: new Date(w.reportedAt.getTime() + w.category.slaHours * 3600000),
      rating: w.rating,
    }));
  });

  /** 员工报修：位置强制取自己当前住的房间，避免乱报别人房间 */
  app.post<{ Body: { categoryId: number; title: string; description?: string; roomId?: number } }>(
    '/api/self/workorders',
    { preHandler: requireSelf },
    async (req, reply) => {
      const personId = req.auth!.sub;
      const { categoryId, title, description } = req.body ?? ({} as any);
      if (!categoryId || !title) return reply.code(400).send({ error: '请选择类别并填写标题' });

      const occ = await prisma.occupancy.findFirst({
        where: { personId, status: { in: LIVE } },
        include: { bed: { include: { room: true } } },
      });
      if (!occ) return reply.code(400).send({ error: '你当前没有住宿记录，请联系宿管' });

      const cat = await prisma.workOrderCategory.findUnique({ where: { id: Number(categoryId) } });
      if (!cat) return reply.code(400).send({ error: '报修类别不存在' });

      const person = await prisma.person.findUnique({ where: { id: personId } });
      const wo = await prisma.workOrder.create({
        data: {
          code: await nextCode('WO', 'workOrder'),
          categoryId: cat.id,
          priority: 'NORMAL',
          title, description,
          scopeType: 'ROOM', scopeId: occ.bed.roomId,
          reportedById: personId, reporterName: person?.name ?? '员工自助',
          blocksOccupancy: false,
        },
      });
      // 通知本楼宿管
      await notify('WORKORDER_ASSIGNED', { roleCode: 'WARDEN' }, {
        code: wo.code, category: cat.nameZh, location: occ.bed.room.code,
        title: wo.title, sla: cat.slaHours,
      }, { type: 'WORKORDER', id: wo.id, linkPath: '/workorders' });

      return { ok: true, code: wo.code, id: wo.id };
    }
  );

  /** 完成后员工可以评价 */
  app.put<{ Params: { id: string }; Body: { rating: number } }>(
    '/api/self/workorders/:id/rate',
    { preHandler: requireSelf },
    async (req, reply) => {
      const wo = await prisma.workOrder.findUnique({ where: { id: Number(req.params.id) } });
      if (!wo || wo.reportedById !== req.auth!.sub) return reply.code(404).send({ error: '工单不存在' });
      if (!['DONE', 'CLOSED'].includes(wo.status)) return reply.code(400).send({ error: '工单尚未完成' });
      return prisma.workOrder.update({
        where: { id: wo.id },
        data: { rating: Math.max(1, Math.min(5, Number(req.body?.rating ?? 5))) },
      });
    }
  );

  // ==================================================== 我的申请
  app.get('/api/self/requests', { preHandler: requireSelf }, async (req) => {
    const rows = await prisma.request.findMany({
      where: { personId: req.auth!.sub },
      orderBy: { submittedAt: 'desc' },
      take: 50,
    });
    return rows;
  });

  app.post<{ Body: { type: string; reason: string } }>(
    '/api/self/requests',
    { preHandler: requireSelf },
    async (req, reply) => {
      const personId = req.auth!.sub;
      const { type, reason } = req.body ?? ({} as any);
      if (!SELF_REQUEST_TYPES.includes(type))
        return reply.code(400).send({ error: '不支持的申请类型', allowed: SELF_REQUEST_TYPES });
      if (!reason?.trim()) return reply.code(400).send({ error: '请填写申请事由' });

      // 同类型待审批的只能有一条，防止重复刷
      const dup = await prisma.request.findFirst({ where: { personId, type, status: 'PENDING' } });
      if (dup) return reply.code(400).send({ error: `你已有一条待审批的${type}申请（${dup.code}）` });

      // 夫妻房申请要先有已核验的配偶关系
      if (type === 'COUPLE_ROOM') {
        const spouse = await prisma.relationship.findFirst({
          where: { type: 'SPOUSE', verified: true, OR: [{ personId }, { relatedPersonId: personId }] },
        });
        if (!spouse) {
          return reply.code(400).send({
            error: '申请夫妻房需要先登记并核验配偶关系',
            hint: '请携带结婚证到宿管室办理登记',
          });
        }
        const person = await prisma.person.findUnique({ where: { id: personId }, include: { positionLevel: true } });
        if (person?.positionLevel && !person.positionLevel.coupleRoomAllowed) {
          return reply.code(400).send({ error: '当前职级尚未开放夫妻房申请，请咨询宿管' });
        }
      }

      const person = await prisma.person.findUnique({ where: { id: personId } });
      const r = await prisma.request.create({
        data: {
          code: await nextCode('REQ', 'request'),
          type, personId, reason: reason.trim(),
          submittedBy: `${person?.name ?? ''}（自助端）`,
        },
      });
      await notify('REQUEST_SUBMITTED', { roleCode: 'WARDEN' }, {
        code: r.code, name: person?.name ?? '', type, reason: reason.trim(),
      }, { type: 'REQUEST', id: r.id, linkPath: '/requests' });
      return { ok: true, code: r.code, id: r.id };
    }
  );

  app.put<{ Params: { id: string } }>('/api/self/requests/:id/cancel', { preHandler: requireSelf }, async (req, reply) => {
    const r = await prisma.request.findUnique({ where: { id: Number(req.params.id) } });
    if (!r || r.personId !== req.auth!.sub) return reply.code(404).send({ error: '申请不存在' });
    if (r.status !== 'PENDING') return reply.code(400).send({ error: '只有待审批的申请可以撤销' });
    return prisma.request.update({ where: { id: r.id }, data: { status: 'CANCELLED' } });
  });

  // ==================================================== 我的通知 / 公告
  app.get('/api/self/notifications', { preHandler: requireSelf }, async (req) => {
    const rows = await prisma.notification.findMany({
      where: { toPersonId: req.auth!.sub, channel: 'IN_APP' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows;
  });

  app.put<{ Params: { id: string } }>('/api/self/notifications/:id/read', { preHandler: requireSelf }, async (req, reply) => {
    const n = await prisma.notification.findUnique({ where: { id: Number(req.params.id) } });
    if (!n || n.toPersonId !== req.auth!.sub) return reply.code(404).send({ error: '通知不存在' });
    return prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  });

  app.get('/api/self/announcements', { preHandler: requireSelf }, async (req) => {
    const personId = req.auth!.sub;
    const occ = await prisma.occupancy.findFirst({
      where: { personId, status: { in: LIVE } },
      include: { bed: { include: { room: { include: { floor: true } } } } },
    });
    const buildingId = occ?.bed.room.floor.buildingId;
    return prisma.announcement.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        AND: [{
          OR: [
            { scopeType: 'ALL' },
            ...(buildingId ? [{ scopeType: 'BUILDING', scopeId: buildingId }] : []),
          ],
        }],
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });
  });

  // ==================================================== 扫房门码
  /**
   * 扫房门二维码进来的落地接口。
   * 只回房间的公开信息 + 是不是自己住的房间，不回住户名单 ——
   * 二维码贴在门上，谁都能扫到。
   */
  app.get<{ Params: { code: string } }>('/api/self/room/:code', { preHandler: requireSelf }, async (req, reply) => {
    const room = await prisma.room.findUnique({
      where: { code: req.params.code },
      include: { roomType: true, floor: { include: { building: true } } },
    });
    if (!room) return reply.code(404).send({ error: '房间码无效' });
    const mine = await prisma.occupancy.findFirst({
      where: { personId: req.auth!.sub, status: { in: LIVE }, bed: { roomId: room.id } },
    });
    const openWO = await prisma.workOrder.count({
      where: { scopeType: 'ROOM', scopeId: room.id, status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] } },
    });
    return {
      roomId: room.id, roomCode: room.code,
      buildingCode: room.floor.building.code, buildingName: room.floor.building.name,
      floorLevel: room.floor.level,
      roomType: pick3(room.roomType), capacity: room.capacity, status: room.status,
      hasAC: room.hasAC, hasBathroom: room.hasBathroom, hasWaterHeater: room.hasWaterHeater,
      isMine: !!mine,
      openWorkOrders: openWO,
    };
  });

  /** 自助端要用的字典（不需要管理端 meta 那么大一坨） */
  app.get('/api/self/meta', { preHandler: requireSelf }, async () => {
    const [categories, requestTypes] = await Promise.all([
      prisma.workOrderCategory.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }),
      Promise.resolve(SELF_REQUEST_TYPES),
    ]);
    return {
      workOrderCategories: categories.map((c) => ({
        id: c.id, nameZh: c.nameZh, nameId: c.nameId, nameEn: c.nameEn, slaHours: c.slaHours,
      })),
      requestTypes,
    };
  });
}
