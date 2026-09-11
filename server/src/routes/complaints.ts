import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { nextCode } from '../services/space.js';
import { requirePerm, actor, audit } from '../services/auth.js';
import { notify } from '../services/notify.js';
import {
  COMPLAINT_INCLUDE, OPEN_STATUS, complaintScope, canRevealIdentity,
  serializeComplaint, locationLabel, findRelated, logEvent, getSetting,
} from '../services/complaints.js';

/**
 * 投诉管理（管理端）。
 *
 * 处理链路是刻意分成四步的：受理 → 核实 → 认定 → 归档。
 * 每一步都写 ComplaintEvent，因为「谁把这条判成不成立的」将来一定会被问到。
 *
 * 认定成立才生成 Violation。投诉本身永远不扣分 —— 见 schema 里的注释。
 */

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? 'data/uploads/complaints');

export default async function complaintRoutes(app: FastifyInstance) {
  // ==================================================== 列表
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/complaints',
    { preHandler: requirePerm('complaint:read') },
    async (req) => {
      const page = Number(req.query.page ?? 1);
      const pageSize = Math.min(Number(req.query.pageSize ?? 20), 200);
      const where: any = { AND: [complaintScope(req)] };

      if (req.query.status) where.AND.push({ status: req.query.status });
      if (req.query.open === 'true') where.AND.push({ status: { in: OPEN_STATUS } });
      if (req.query.typeId) where.AND.push({ typeId: Number(req.query.typeId) });
      if (req.query.anonymous) where.AND.push({ anonymous: req.query.anonymous === 'true' });
      if (req.query.buildingId) {
        const bid = Number(req.query.buildingId);
        where.AND.push({
          OR: [
            { targetRoom: { floor: { buildingId: bid } } },
            { targetFloor: { buildingId: bid } },
          ],
        });
      }
      if (req.query.q) {
        where.AND.push({
          OR: [
            { code: { contains: req.query.q } },
            { description: { contains: req.query.q } },
            { targetRoom: { code: { contains: req.query.q } } },
          ],
        });
      }

      const [total, rows] = await Promise.all([
        prisma.complaint.count({ where }),
        prisma.complaint.findMany({
          where, include: COMPLAINT_INCLUDE,
          orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
          skip: (page - 1) * pageSize, take: pageSize,
        }),
      ]);

      // canReveal 只告诉前端「要不要显示那个按钮」，身份本身不在这个返回体里
      const canReveal = canRevealIdentity(req);
      return {
        total, page, pageSize,
        rows: rows.map((c) => ({ ...serializeComplaint(c), canReveal: c.anonymous && canReveal })),
      };
    }
  );

  // ==================================================== 统计（看板 / 页头）
  app.get('/api/complaints/stats',
    { preHandler: requirePerm('complaint:read') },
    async (req) => {
      const scope = complaintScope(req);
      const [open, substantiated, unsubstantiated, anonymousCount, total] = await Promise.all([
        prisma.complaint.count({ where: { AND: [scope, { status: { in: OPEN_STATUS } }] } }),
        prisma.complaint.count({ where: { AND: [scope, { status: 'SUBSTANTIATED' }] } }),
        prisma.complaint.count({ where: { AND: [scope, { status: 'UNSUBSTANTIATED' }] } }),
        prisma.complaint.count({ where: { AND: [scope, { anonymous: true }] } }),
        prisma.complaint.count({ where: scope }),
      ]);
      // 认定率：成立 /（成立 + 不成立）。太低说明投诉被滥用，太高说明核实走过场
      const judged = substantiated + unsubstantiated;
      return {
        total, open, substantiated, unsubstantiated, anonymousCount,
        substantiatedRate: judged > 0 ? Math.round((substantiated / judged) * 100) : null,
      };
    }
  );

  // ==================================================== 详情
  app.get<{ Params: { id: string } }>('/api/complaints/:id',
    { preHandler: requirePerm('complaint:read') },
    async (req, reply) => {
      const id = Number(req.params.id);
      const c = await prisma.complaint.findFirst({
        where: { AND: [{ id }, complaintScope(req)] },
        include: COMPLAINT_INCLUDE,
      });
      if (!c) return reply.code(404).send({ error: '投诉不存在或不在你的处理范围内' });

      const [events, related] = await Promise.all([
        prisma.complaintEvent.findMany({ where: { complaintId: id }, orderBy: { createdAt: 'asc' } }),
        findRelated(c),
      ]);

      // 被投诉房间此刻住了谁 —— 认定成立要在这里面选人开违规单
      const occupants = c.targetRoomId
        ? (await prisma.occupancy.findMany({
            where: { bed: { roomId: c.targetRoomId }, status: { in: ['ACTIVE', 'HELD', 'RESERVED'] } },
            include: { person: { include: { department: true } }, bed: true },
          })).map((o) => ({
            personId: o.personId, name: o.person.name, employeeNo: o.person.employeeNo,
            department: o.person.department?.nameZh ?? null, bedCode: o.bed.code,
            nationalityId: o.person.nationalityId,
          }))
        : [];

      return {
        ...serializeComplaint(c),
        canReveal: c.anonymous && canRevealIdentity(req),
        events,
        related: related.rows,
        distinctComplainants: related.distinctComplainants,
        occupants,
        attachments: c.attachments.map((a) => ({
          id: a.id, kind: a.kind, mimeType: a.mimeType, size: a.size,
          originalName: a.originalName, uploadedAt: a.uploadedAt,
          url: `/api/complaints/${c.id}/attachments/${a.id}`,
        })),
      };
    }
  );

  // ==================================================== 揭示匿名投诉人身份
  /**
   * 单独一个接口、单独一个权限点、每次调用写审计。
   *
   * 匿名如果只是前端把名字藏起来，稍微懂点技术的宿管一样看得到，
   * 那"匿名"就是骗人的，传出去之后整个投诉功能就废了。
   * 所以：能看的人很少（不含楼栋宿管），而且**谁在什么时候看了哪条，永远查得到**。
   */
  app.get<{ Params: { id: string } }>('/api/complaints/:id/identity',
    { preHandler: requirePerm('complaint:identity') },
    async (req, reply) => {
      const id = Number(req.params.id);
      const c = await prisma.complaint.findUnique({
        where: { id },
        include: {
          complainant: {
            include: {
              department: true,
              occupancies: {
                where: { status: { in: ['ACTIVE', 'HELD', 'RESERVED'] } },
                include: { bed: { include: { room: true } } }, take: 1,
              },
            },
          },
        },
      });
      if (!c) return reply.code(404).send({ error: '投诉不存在' });
      if (!c.anonymous) return reply.code(400).send({ error: '这条不是匿名投诉，投诉人本来就是公开的' });

      await audit(req, 'COMPLAINT_REVEAL_IDENTITY', {
        targetType: 'COMPLAINT', targetId: id,
        detail: `揭示匿名投诉 ${c.code} 的投诉人身份`,
      });
      await logEvent(id, 'REVEAL_IDENTITY', actor(req), '查看了匿名投诉人身份');

      return {
        id: c.complainant.id, name: c.complainant.name, employeeNo: c.complainant.employeeNo,
        department: c.complainant.department?.nameZh ?? null,
        phone: c.complainant.phone,
        roomCode: c.complainant.occupancies[0]?.bed.room.code ?? null,
        warning: '这是匿名投诉人的身份，仅用于核实与回访，不得向被投诉方透露。本次查看已记入审计日志。',
      };
    }
  );

  // ==================================================== 宿管代录
  /** 有人当面口头投诉时用。代录的一律实名（记的是宿管听到的，不是匿名渠道） */
  app.post<{ Body: Record<string, any> }>('/api/complaints',
    { preHandler: requirePerm('complaint:write') },
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.typeId || !b.complainantId || !b.occurredFrom) {
        return reply.code(400).send({ error: '请填写投诉类别、投诉人和发生时间' });
      }
      const type = await prisma.complaintType.findUnique({ where: { id: Number(b.typeId) } });
      if (!type) return reply.code(400).send({ error: '投诉类别不存在' });

      const c = await prisma.complaint.create({
        data: {
          code: await nextCode('CP', 'complaint'),
          typeId: type.id,
          complainantId: Number(b.complainantId),
          anonymous: false,
          targetRoomId: b.targetRoomId ? Number(b.targetRoomId) : null,
          targetFloorId: b.targetFloorId ? Number(b.targetFloorId) : null,
          targetArea: b.targetArea ?? null,
          occurredFrom: new Date(b.occurredFrom),
          occurredTo: b.occurredTo ? new Date(b.occurredTo) : null,
          description: b.description ?? null,
          lang: 'zh',
          priority: b.priority ?? 'NORMAL',
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          handledBy: actor(req),
        },
      });
      await logEvent(c.id, 'SUBMIT', actor(req), '宿管代录', true);
      await logEvent(c.id, 'ACCEPT', actor(req), '已受理', true);
      await audit(req, 'COMPLAINT_CREATE', { targetType: 'COMPLAINT', targetId: c.id, detail: c.code });
      return c;
    }
  );

  // ==================================================== 受理 / 核实
  app.put<{ Params: { id: string }; Body: { note?: string } }>('/api/complaints/:id/accept',
    { preHandler: requirePerm('complaint:write') },
    async (req, reply) => {
      const c = await loadInScope(req, reply, Number(req.params.id));
      if (!c) return;
      if (c.status !== 'NEW') return reply.code(400).send({ error: '这条投诉已经受理过了' });

      const updated = await prisma.complaint.update({
        where: { id: c.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), handledBy: actor(req) },
      });
      await logEvent(c.id, 'ACCEPT', actor(req), req.body?.note ?? '已受理，正在安排核实', true);
      // 告诉投诉人一声。不反馈的话，下次就没人再投诉了
      await notify('COMPLAINT_ACCEPTED', { personId: c.complainantId },
        { code: c.code, type: c.type.nameZh },
        { type: 'COMPLAINT', id: c.id, linkPath: '/complaints' });
      return updated;
    }
  );

  app.put<{ Params: { id: string }; Body: { note?: string } }>('/api/complaints/:id/investigate',
    { preHandler: requirePerm('complaint:write') },
    async (req, reply) => {
      const c = await loadInScope(req, reply, Number(req.params.id));
      if (!c) return;
      const updated = await prisma.complaint.update({
        where: { id: c.id },
        data: { status: 'INVESTIGATING', handledBy: actor(req) },
      });
      // 核实过程默认对投诉人不可见 —— "已调取 A-305 门口监控"这种不该让他看到
      await logEvent(c.id, 'INVESTIGATE', actor(req), req.body?.note ?? '开始核实', false);
      return updated;
    }
  );

  // ==================================================== 认定
  /**
   * 认定成立与否。**这是整条链路上唯一能产生违规记录的地方。**
   *
   * 两条硬规矩：
   *   1. `resolution` 必填 —— 不成立也要写清楚为什么，这是要发给投诉人的
   *   2. 违规开给具体的人，由处理人从被投诉房间的在住名单里挑，系统不替他猜
   */
  app.put<{
    Params: { id: string };
    Body: {
      outcome: 'SUBSTANTIATED' | 'UNSUBSTANTIATED' | 'DUPLICATE';
      resolution: string;
      violationTypeId?: number;
      violationPersonIds?: number[];
      points?: number;
      fine?: number;
    };
  }>('/api/complaints/:id/resolve',
    { preHandler: requirePerm('complaint:write') },
    async (req, reply) => {
      const c = await loadInScope(req, reply, Number(req.params.id));
      if (!c) return;
      const b = req.body ?? ({} as any);
      const outcome = b.outcome;
      if (!['SUBSTANTIATED', 'UNSUBSTANTIATED', 'DUPLICATE'].includes(outcome)) {
        return reply.code(400).send({ error: '请给出认定结论' });
      }
      if (!b.resolution?.trim()) {
        return reply.code(400).send({ error: '必须填写认定说明 —— 不成立也要给投诉人一个说法' });
      }

      let violationId: number | null = null;
      const createdCodes: string[] = [];

      if (outcome === 'SUBSTANTIATED') {
        const typeId = b.violationTypeId ?? c.type.violationTypeId ?? null;
        if (typeId) {
          const vt = await prisma.violationType.findUnique({ where: { id: Number(typeId) } });
          if (!vt) return reply.code(400).send({ error: '违规类型不存在' });
          // 选了人就一人一条；没选人就在房间上记一条（找不到具体责任人时的常见情况）
          const targets: (number | null)[] =
            b.violationPersonIds && b.violationPersonIds.length > 0 ? b.violationPersonIds : [null];
          for (const personId of targets) {
            const v = await prisma.violation.create({
              data: {
                code: await nextCode('VIO', 'violation'),
                personId: personId ?? null,
                roomId: c.targetRoomId ?? null,
                typeId: vt.id,
                occurredAt: c.occurredFrom,
                points: b.points ?? vt.defaultPoints,
                fine: b.fine ?? vt.defaultFine,
                description: `由投诉 ${c.code} 认定成立：${b.resolution.trim()}`,
                evidence: `投诉 ${c.code}`,
                recordedBy: actor(req),
                status: 'OPEN',
              },
            });
            createdCodes.push(v.code);
            violationId = violationId ?? v.id;
            if (personId) {
              await notify('VIOLATION_RECORDED', { personId },
                { type: vt.nameZh, points: v.points, fine: v.fine > 0 ? `、罚款 ${v.fine}` : '' },
                { type: 'VIOLATION', id: v.id, linkPath: '/violations' });
            }
          }
        }
      }

      const updated = await prisma.complaint.update({
        where: { id: c.id },
        data: {
          status: outcome,
          resolution: b.resolution.trim(),
          resolvedAt: new Date(),
          handledBy: actor(req),
          violationId,
        },
      });

      const noteSuffix = createdCodes.length > 0 ? `（已开违规单 ${createdCodes.join('、')}）` : '';
      await logEvent(c.id, 'RESOLVE', actor(req), `${outcomeLabel(outcome)}：${b.resolution.trim()}${noteSuffix}`, true);
      await audit(req, 'COMPLAINT_RESOLVE', {
        targetType: 'COMPLAINT', targetId: c.id,
        detail: `${c.code} → ${outcome}${noteSuffix}`,
      });

      await notify('COMPLAINT_RESOLVED', { personId: c.complainantId }, {
        code: c.code, type: c.type.nameZh,
        outcome: outcomeLabel(outcome), resolution: b.resolution.trim(),
      }, { type: 'COMPLAINT', id: c.id, linkPath: '/complaints' });

      return { ...updated, violationCodes: createdCodes };
    }
  );

  app.put<{ Params: { id: string }; Body: { note?: string } }>('/api/complaints/:id/close',
    { preHandler: requirePerm('complaint:write') },
    async (req, reply) => {
      const c = await loadInScope(req, reply, Number(req.params.id));
      if (!c) return;
      const updated = await prisma.complaint.update({
        where: { id: c.id }, data: { status: 'CLOSED', closedAt: new Date() },
      });
      await logEvent(c.id, 'CLOSE', actor(req), req.body?.note ?? '已归档', true);
      return updated;
    }
  );

  app.post<{ Params: { id: string }; Body: { note: string; visibleToComplainant?: boolean } }>(
    '/api/complaints/:id/comment',
    { preHandler: requirePerm('complaint:write') },
    async (req, reply) => {
      const c = await loadInScope(req, reply, Number(req.params.id));
      if (!c) return;
      if (!req.body?.note?.trim()) return reply.code(400).send({ error: '备注内容不能为空' });
      await logEvent(c.id, 'COMMENT', actor(req), req.body.note.trim(), req.body.visibleToComplainant ?? false);
      return { ok: true };
    }
  );

  /** 合并重复投诉。原始记录一条不删 —— 只是指向主单，人数统计仍然按原始条数算 */
  app.put<{ Params: { id: string }; Body: { intoId: number } }>('/api/complaints/:id/merge',
    { preHandler: requirePerm('complaint:write') },
    async (req, reply) => {
      const c = await loadInScope(req, reply, Number(req.params.id));
      if (!c) return;
      const intoId = Number(req.body?.intoId);
      if (!intoId || intoId === c.id) return reply.code(400).send({ error: '请选择要合并到的投诉' });
      const into = await prisma.complaint.findUnique({ where: { id: intoId } });
      if (!into) return reply.code(400).send({ error: '目标投诉不存在' });

      const updated = await prisma.complaint.update({
        where: { id: c.id },
        data: { status: 'DUPLICATE', mergedIntoId: intoId, resolvedAt: new Date(), handledBy: actor(req) },
      });
      await logEvent(c.id, 'MERGE', actor(req), `与 ${into.code} 是同一件事，已合并`, true);
      await logEvent(intoId, 'COMMENT', actor(req), `${c.code} 反映同一件事，已并入本单`, false);
      return updated;
    }
  );

  // ==================================================== 附件下载
  /**
   * 附件不放 nginx 静态目录，走鉴权接口。
   * 投诉的照片里可能有人脸、房间内景，属于不该公开可达的东西。
   */
  app.get<{ Params: { id: string; attId: string } }>('/api/complaints/:id/attachments/:attId',
    { preHandler: requirePerm('complaint:read') },
    async (req, reply) => {
      const c = await prisma.complaint.findFirst({
        where: { AND: [{ id: Number(req.params.id) }, complaintScope(req)] },
      });
      if (!c) return reply.code(404).send({ error: '投诉不存在或不在你的处理范围内' });
      const att = await prisma.complaintAttachment.findFirst({
        where: { id: Number(req.params.attId), complaintId: c.id },
      });
      if (!att) return reply.code(404).send({ error: '附件不存在' });

      const file = path.join(UPLOAD_DIR, att.storedName);
      if (!fs.existsSync(file)) return reply.code(404).send({ error: '附件文件已丢失' });
      reply.header('Content-Type', att.mimeType);
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(fs.createReadStream(file));
    }
  );

  // ==================================================== 反复被投诉的房间
  /**
   * 「同一房间被多人反复反映」是这套数据里信噪比最高的信号，
   * 单独开一个接口，因为它同时服务于告警和管理端的排行榜。
   */
  app.get('/api/complaints/hot-rooms',
    { preHandler: requirePerm('complaint:read') },
    async (req) => {
      const days = await getSetting<number>('complaint.hotRoomWindowDays', 30);
      const since = new Date(Date.now() - days * 86400000);
      const rows = await prisma.complaint.findMany({
        where: {
          AND: [complaintScope(req), { submittedAt: { gte: since } },
                { targetRoomId: { not: null } }, { status: { notIn: ['WITHDRAWN'] } }],
        },
        include: { targetRoom: { include: { floor: { include: { building: true } } } }, type: true },
      });

      const byRoom = new Map<number, any>();
      for (const c of rows) {
        const key = c.targetRoomId!;
        if (!byRoom.has(key)) {
          byRoom.set(key, {
            roomId: key, roomCode: c.targetRoom!.code,
            buildingCode: c.targetRoom!.floor.building.code,
            floorLevel: c.targetRoom!.floor.level,
            count: 0, complainants: new Set<number>(), substantiated: 0, types: new Set<string>(),
          });
        }
        const r = byRoom.get(key);
        r.count += 1;
        r.complainants.add(c.complainantId);
        r.types.add(c.type.nameZh);
        if (c.status === 'SUBSTANTIATED') r.substantiated += 1;
      }

      return [...byRoom.values()]
        .map((r) => ({
          ...r,
          complainants: r.complainants.size,
          types: [...r.types],
          // 不同人反映 vs 同一个人反复投 —— 这两种情况处理方式完全不同
          singleSource: r.complainants.size === 1 && r.count > 1,
        }))
        .filter((r) => r.count > 1)
        .sort((a, b) => b.complainants - a.complainants || b.count - a.count)
        .slice(0, 50);
    }
  );
}

const outcomeLabel = (o: string) =>
  o === 'SUBSTANTIATED' ? '认定成立' : o === 'UNSUBSTANTIATED' ? '认定不成立' : '重复投诉';

/** 取一条投诉并确认它在当前用户的处理范围内，不在就直接 404（不透露它存在） */
async function loadInScope(req: any, reply: any, id: number) {
  const c = await prisma.complaint.findFirst({
    where: { AND: [{ id }, complaintScope(req)] },
    include: { type: true },
  });
  if (!c) {
    reply.code(404).send({ error: '投诉不存在或不在你的处理范围内' });
    return null;
  }
  return c;
}
