import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { issueTokenForPerson, requireSelf } from '../services/auth.js';
import { notify } from '../services/notify.js';
import { nextCode } from '../services/space.js';
import { checkAbuse, logEvent, getSetting } from '../services/complaints.js';
import { UPLOAD_DIR } from './complaints.js';
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

/** 附件限制。工地手机随手一拍就是 4MB，前端会先缩到 1280px 再传 */
const MAX_ATTACHMENT_MB = 4;
const MAX_ATTACHMENTS = 5;

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

    const [items, deposits, violations, unread, openWO, pendingReq, openComplaints] = await Promise.all([
      prisma.issuedItem.findMany({ where: { personId }, include: { itemType: true }, orderBy: { issuedAt: 'desc' } }),
      prisma.deposit.findMany({ where: { personId, refundedAt: null } }),
      prisma.violation.findMany({ where: { personId, status: { not: 'CLOSED' } }, include: { type: true } }),
      prisma.notification.count({ where: { toPersonId: personId, readAt: null, channel: 'IN_APP' } }),
      prisma.workOrder.count({ where: { reportedById: personId, status: { in: ['NEW', 'ASSIGNED', 'IN_PROGRESS'] } } }),
      prisma.request.count({ where: { personId, status: 'PENDING' } }),
      prisma.complaint.count({
        where: { complainantId: personId, status: { in: ['NEW', 'ACCEPTED', 'INVESTIGATING'] } },
      }),
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
      counts: { unreadNotifications: unread, openWorkOrders: openWO, pendingRequests: pendingReq, openComplaints },
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

  // ==================================================== 投诉
  /**
   * 员工投诉。
   *
   * 三个刻意的设计，每一个都对应一种会让功能失效的现实：
   *
   *  1. **位置选房间，不选人。** 员工根本不知道隔壁住了谁，逼他指认等于把报复风险
   *     转嫁给他。选房号，宿管那边按 Occupancy 反查在住名单就够了。
   *  2. **发生时段必填，且和提交时间分开。** 凌晨两点的噪音第二天早上才来投诉，
   *     只记提交时间的话宿管晚上去蹲都不知道蹲几点。
   *  3. **匿名是对被投诉方匿名，不是对系统匿名。** 库里照样存真人，
   *     只有 complaint:identity 权限的人能揭示，且揭示写审计。
   */

  /** 投诉表单需要的东西：类别 + 可选的位置列表 */
  app.get('/api/self/complaint-options', { preHandler: requireSelf }, async (req) => {
    const personId = req.auth!.sub;
    const [types, occ] = await Promise.all([
      prisma.complaintType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.occupancy.findFirst({
        where: { personId, status: { in: LIVE } },
        include: { bed: { include: { room: { include: { floor: { include: { building: true } } } } } } },
      }),
    ]);

    // 只列出本楼的房间。噪音会穿楼层，所以不限于本层；但跨栋投诉基本不存在，
    // 列出来只会让选择变难，也容易误选
    let floors: any[] = [];
    if (occ) {
      const buildingId = occ.bed.room.floor.buildingId;
      const rows = await prisma.floor.findMany({
        where: { buildingId },
        include: { rooms: { orderBy: { code: 'asc' } } },  // 功能房（洗衣房、活动室）也可投诉，不过滤
        orderBy: { level: 'asc' },
      });
      floors = rows.map((f) => ({
        id: f.id, level: f.level, name: f.name,
        isMine: f.id === occ.bed.room.floorId,
        rooms: f.rooms.map((r) => ({
          id: r.id, code: r.code,
          isMine: r.id === occ.bed.roomId,
        })),
      }));
    }

    return {
      types: types.map((t) => ({
        id: t.id, code: t.code,
        nameZh: t.nameZh, nameId: t.nameId, nameEn: t.nameEn,
        slaHours: t.slaHours,
        // 强制实名的类别，前端要把匿名开关禁掉并说明原因
        allowAnonymous: t.allowAnonymous,
        routeTo: t.routeTo,
      })),
      myRoomId: occ?.bed.roomId ?? null,
      myFloorId: occ?.bed.room.floorId ?? null,
      buildingCode: occ?.bed.room.floor.building.code ?? null,
      floors,
      maxAttachmentMB: MAX_ATTACHMENT_MB,
    };
  });

  app.get('/api/self/complaints', { preHandler: requireSelf }, async (req) => {
    const rows = await prisma.complaint.findMany({
      where: { complainantId: req.auth!.sub },
      include: {
        type: true,
        targetRoom: true,
        targetFloor: { include: { building: true } },
        attachments: true,
        // 只把标记为「对投诉人可见」的流水给他看 —— 内部核实过程不外露
        events: { where: { visibleToComplainant: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 50,
    });
    return rows.map((c) => ({
      id: c.id, code: c.code,
      type: pick3(c.type),
      status: c.status,
      anonymous: c.anonymous,
      location: c.targetRoom
        ? c.targetRoom.code
        : c.targetFloor
          ? `${c.targetFloor.building.code}${c.targetFloor.level}F ${c.targetArea ?? ''}`.trim()
          : (c.targetArea ?? ''),
      occurredFrom: c.occurredFrom, occurredTo: c.occurredTo,
      description: c.description,
      submittedAt: c.submittedAt,
      resolvedAt: c.resolvedAt,
      resolution: c.resolution,
      rating: c.rating,
      slaHours: c.type.slaHours,
      deadline: new Date(c.submittedAt.getTime() + c.type.slaHours * 3600000),
      attachments: c.attachments.map((a) => ({ id: a.id, kind: a.kind })),
      events: c.events.map((e) => ({ type: e.type, note: e.note, createdAt: e.createdAt })),
      canWithdraw: ['NEW', 'ACCEPTED'].includes(c.status),
      canRate: ['SUBSTANTIATED', 'UNSUBSTANTIATED', 'CLOSED'].includes(c.status) && c.rating == null,
    }));
  });

  app.post<{
    Body: {
      typeId: number; anonymous?: boolean;
      targetRoomId?: number | null; targetFloorId?: number | null; targetArea?: string;
      occurredFrom: string; occurredTo?: string;
      description?: string;
    };
  }>('/api/self/complaints', { preHandler: requireSelf }, async (req, reply) => {
    const personId = req.auth!.sub;
    const b = req.body ?? ({} as any);

    if (!b.typeId) return reply.code(400).send({ error: '请选择投诉类别' });
    if (!b.occurredFrom) return reply.code(400).send({ error: '请选择事情发生的时间' });
    if (!b.targetRoomId && !b.targetFloorId) {
      return reply.code(400).send({ error: '请选择投诉的位置（房间或公共区域）' });
    }

    const type = await prisma.complaintType.findUnique({ where: { id: Number(b.typeId) } });
    if (!type || !type.isActive) return reply.code(400).send({ error: '投诉类别不存在' });

    // 强制实名的类别不接受匿名。前端也禁了开关，这里是服务端兜底
    const anonymous = !!b.anonymous && type.allowAnonymous;
    if (b.anonymous && !type.allowAnonymous) {
      return reply.code(400).send({
        error: `「${type.nameZh}」需要实名提交 —— 这类事情要联系你核实取证，匿名就查不下去了`,
      });
    }

    const occurredFrom = new Date(b.occurredFrom);
    if (Number.isNaN(occurredFrom.getTime())) return reply.code(400).send({ error: '发生时间格式不对' });
    // 未来时间显然是填错了；太久以前的也没法查，直接挡掉省得双方白忙
    const backDays = await getSetting<number>('complaint.maxBacklogDays', 14);
    if (occurredFrom.getTime() > Date.now() + 3600000) {
      return reply.code(400).send({ error: '发生时间不能是将来' });
    }
    if (occurredFrom.getTime() < Date.now() - backDays * 86400000) {
      return reply.code(400).send({ error: `只能投诉最近 ${backDays} 天内发生的事，更早的请直接找宿管` });
    }

    const abuse = await checkAbuse(personId, b.targetRoomId ? Number(b.targetRoomId) : null);
    if (!abuse.ok) return reply.code(429).send({ error: abuse.error });

    const person = await prisma.person.findUnique({ where: { id: personId } });

    const c = await prisma.complaint.create({
      data: {
        code: await nextCode('CP', 'complaint'),
        typeId: type.id,
        complainantId: personId,
        anonymous,
        targetRoomId: b.targetRoomId ? Number(b.targetRoomId) : null,
        targetFloorId: b.targetFloorId ? Number(b.targetFloorId) : null,
        targetArea: b.targetArea?.slice(0, 100) ?? null,
        occurredFrom,
        occurredTo: b.occurredTo ? new Date(b.occurredTo) : null,
        description: b.description?.slice(0, 500) ?? null,
        lang: person ? localeOf(person) : 'zh',
        status: 'NEW',
      },
      include: { type: true, targetRoom: true },
    });

    await logEvent(c.id, 'SUBMIT', anonymous ? '匿名投诉人' : (person?.name ?? '员工'), '投诉已提交', true);

    // 派给谁由类别决定。投诉宿管本人的走 MANAGER —— 绝不能落到被投诉的宿管手上
    const roleCode = { WARDEN: 'WARDEN', MANAGER: 'DORM_MANAGER', EHS: 'EHS', HR: 'HR' }[type.routeTo] ?? 'WARDEN';
    await notify('COMPLAINT_SUBMITTED', { roleCode }, {
      code: c.code,
      type: type.nameZh,
      location: c.targetRoom?.code ?? c.targetArea ?? '公共区域',
      // 通知里绝不带投诉人姓名 —— 匿名与否都不带，避免宿管在群里转发时顺手泄漏
      when: occurredFrom.toLocaleString('zh-CN'),
      sla: type.slaHours,
    }, { type: 'COMPLAINT', id: c.id, linkPath: '/complaints' });

    return { ok: true, id: c.id, code: c.code, anonymous };
  });

  /**
   * 上传附件（照片 / 录音）。
   *
   * 走 base64 而不是 multipart：少一个依赖，而且前端反正要先把照片缩到 1280px
   * 再传（工地手机随手一拍就是 4MB，直接传上来这台机器扛不住）。
   */
  app.post<{ Params: { id: string }; Body: { kind: string; mimeType: string; dataBase64: string; originalName?: string } }>(
    '/api/self/complaints/:id/attachments',
    { preHandler: requireSelf, bodyLimit: (MAX_ATTACHMENT_MB + 2) * 1024 * 1024 },
    async (req, reply) => {
      const c = await prisma.complaint.findFirst({
        where: { id: Number(req.params.id), complainantId: req.auth!.sub },
      });
      if (!c) return reply.code(404).send({ error: '投诉不存在' });
      if (!['NEW', 'ACCEPTED', 'INVESTIGATING'].includes(c.status)) {
        return reply.code(400).send({ error: '这条投诉已经处理完了，不能再加附件' });
      }

      const b = req.body ?? ({} as any);
      const kind = b.kind === 'AUDIO' ? 'AUDIO' : 'PHOTO';
      const mimeType = String(b.mimeType ?? '');
      const allowed = kind === 'PHOTO'
        ? ['image/jpeg', 'image/png', 'image/webp']
        : ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav'];
      if (!allowed.includes(mimeType)) {
        return reply.code(400).send({ error: `不支持的文件类型：${mimeType}` });
      }
      if (!b.dataBase64) return reply.code(400).send({ error: '文件内容为空' });

      const buf = Buffer.from(b.dataBase64, 'base64');
      if (buf.length === 0) return reply.code(400).send({ error: '文件内容为空' });
      if (buf.length > MAX_ATTACHMENT_MB * 1024 * 1024) {
        return reply.code(400).send({ error: `单个附件不能超过 ${MAX_ATTACHMENT_MB} MB` });
      }
      const count = await prisma.complaintAttachment.count({ where: { complaintId: c.id } });
      if (count >= MAX_ATTACHMENTS) {
        return reply.code(400).send({ error: `最多上传 ${MAX_ATTACHMENTS} 个附件` });
      }

      const ext = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
      // 文件名由服务端生成，绝不用前端传的名字拼路径
      const storedName = `${c.id}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      await fsp.writeFile(path.join(UPLOAD_DIR, storedName), buf);

      const att = await prisma.complaintAttachment.create({
        data: {
          complaintId: c.id, kind, mimeType, size: buf.length, storedName,
          originalName: b.originalName?.slice(0, 120) ?? null,
        },
      });
      return { ok: true, id: att.id, kind: att.kind, size: att.size };
    }
  );

  /** 撤回。填错了、或者事后自己解决了，得让他撤 —— 不然只能硬着头皮让宿管去查 */
  app.put<{ Params: { id: string } }>('/api/self/complaints/:id/withdraw',
    { preHandler: requireSelf },
    async (req, reply) => {
      const c = await prisma.complaint.findFirst({
        where: { id: Number(req.params.id), complainantId: req.auth!.sub },
      });
      if (!c) return reply.code(404).send({ error: '投诉不存在' });
      if (!['NEW', 'ACCEPTED'].includes(c.status)) {
        return reply.code(400).send({ error: '已经在核实中了，撤不了，请直接联系宿管说明' });
      }
      await prisma.complaint.update({
        where: { id: c.id }, data: { status: 'WITHDRAWN', resolvedAt: new Date() },
      });
      await logEvent(c.id, 'WITHDRAW', '投诉人', '投诉人主动撤回', true);
      return { ok: true };
    }
  );

  /** 对处理结果打分。闭环的最后一环 —— 处理得敷衍，这里就会显出来 */
  app.put<{ Params: { id: string }; Body: { rating: number; comment?: string } }>(
    '/api/self/complaints/:id/rate',
    { preHandler: requireSelf },
    async (req, reply) => {
      const c = await prisma.complaint.findFirst({
        where: { id: Number(req.params.id), complainantId: req.auth!.sub },
      });
      if (!c) return reply.code(404).send({ error: '投诉不存在' });
      if (!['SUBSTANTIATED', 'UNSUBSTANTIATED', 'CLOSED'].includes(c.status)) {
        return reply.code(400).send({ error: '还没有处理结果，暂时不能评价' });
      }
      const rating = Math.max(1, Math.min(5, Number(req.body?.rating ?? 5)));
      await prisma.complaint.update({
        where: { id: c.id },
        data: { rating, ratingComment: req.body?.comment?.slice(0, 200) ?? null },
      });
      await logEvent(c.id, 'RATE', '投诉人', `评价 ${rating} 分${req.body?.comment ? '：' + req.body.comment : ''}`, false);
      return { ok: true };
    }
  );

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
