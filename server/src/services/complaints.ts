import type { FastifyRequest } from 'fastify';
import { prisma, getSetting } from '../db.js';
import { hasPermission, buildingScope } from './auth.js';

/**
 * 投诉的可见性与防滥用。
 *
 * 这个文件存在的唯一理由：**投诉里有两样东西不能靠"前端别显示"来保护**——
 *   1. 匿名投诉人的身份
 *   2. 投诉宿管本人的那类投诉（不能落到被投诉的宿管手上）
 * 两样都必须在服务端收口，所以集中在这里，别的地方一律调这里的函数。
 */

/** 投诉状态：处理中的几个状态，用于「未办结」判定 */
export const OPEN_STATUS = ['NEW', 'ACCEPTED', 'INVESTIGATING'];
/** 终态 */
export const FINAL_STATUS = ['SUBSTANTIATED', 'UNSUBSTANTIATED', 'DUPLICATE', 'WITHDRAWN', 'CLOSED'];

export const COMPLAINT_STATUSES = [...OPEN_STATUS, ...FINAL_STATUS];
export const COMPLAINT_ROUTES = ['WARDEN', 'MANAGER', 'EHS', 'HR'];

/**
 * 当前用户能看到哪些投诉，返回一个可直接并进 where 的条件。
 *
 * 规则有两层，缺一不可：
 *   - 楼栋范围：沿用全局的 buildingScope（A 栋宿管只看 A 栋）
 *   - **派发路径**：没有 complaint:all 的人只看得到 routeTo=WARDEN 的投诉。
 *     投诉宿管本人的那类走 MANAGER/HR，宿管在自己的列表里根本看不到它存在 ——
 *     这是「投诉宿管」这条路能走通的前提。
 */
export function complaintScope(req: FastifyRequest) {
  const conds: any[] = [];

  if (!hasPermission(req.auth?.perms ?? [], 'complaint:all')) {
    conds.push({ type: { routeTo: 'WARDEN' } });
  }

  const buildings = buildingScope(req);
  if (buildings) {
    // 位置可能落在房间上，也可能落在楼层上（公共区域投诉）
    conds.push({
      OR: [
        { targetRoom: { floor: { buildingId: { in: buildings } } } },
        { targetFloor: { buildingId: { in: buildings } } },
      ],
    });
  }

  return conds.length === 0 ? {} : conds.length === 1 ? conds[0] : { AND: conds };
}

export { getSetting };

/** 能不能看到匿名投诉人的真实身份 */
export const canRevealIdentity = (req: FastifyRequest) =>
  hasPermission(req.auth?.perms ?? [], 'complaint:identity');

/**
 * 把一条投诉序列化成给管理端看的样子。
 *
 * **匿名投诉的投诉人字段在这里一律不出现 —— 不看权限。**
 * 注意是「不出现」，不是返回 null 再由前端隐藏：少一个字段，就少一条泄漏路径。
 *
 * 有 complaint:identity 权限的人也一样看不到，他必须单独调 /identity 接口，
 * 那一次调用会写审计。如果列表直接把名字带出来，
 * 「谁在什么时候看了哪条匿名投诉」就永远查不到了 —— 匿名也就名存实亡。
 */
export function serializeComplaint(c: any) {
  const anonymous = c.anonymous;
  const base: any = {
    id: c.id,
    code: c.code,
    typeId: c.typeId,
    type: c.type ? { zh: c.type.nameZh, id: c.type.nameId, en: c.type.nameEn } : null,
    typeCode: c.type?.code ?? null,
    routeTo: c.type?.routeTo ?? null,
    severity: c.type?.severity ?? null,
    slaHours: c.type?.slaHours ?? null,
    anonymous,
    targetRoomId: c.targetRoomId,
    targetRoomCode: c.targetRoom?.code ?? null,
    targetFloorId: c.targetFloorId,
    targetArea: c.targetArea,
    location: locationLabel(c),
    occurredFrom: c.occurredFrom,
    occurredTo: c.occurredTo,
    description: c.description,
    lang: c.lang,
    status: c.status,
    priority: c.priority,
    handledBy: c.handledBy,
    acceptedAt: c.acceptedAt,
    resolvedAt: c.resolvedAt,
    closedAt: c.closedAt,
    resolution: c.resolution,
    violationId: c.violationId,
    mergedIntoId: c.mergedIntoId,
    rating: c.rating,
    ratingComment: c.ratingComment,
    submittedAt: c.submittedAt,
    deadline: c.type ? new Date(c.submittedAt.getTime() + c.type.slaHours * 3600000) : null,
    attachmentCount: c.attachments?.length ?? c._count?.attachments ?? 0,
  };

  if (!anonymous) {
    base.complainant = c.complainant
      ? {
          id: c.complainant.id,
          name: c.complainant.name,
          employeeNo: c.complainant.employeeNo,
          department: c.complainant.department?.nameZh ?? null,
          nationalityId: c.complainant.nationalityId,
          roomCode: c.complainant.occupancies?.[0]?.bed?.room?.code ?? null,
        }
      : null;
  }

  return base;
}

/** 位置的可读描述。公共区域投诉没有房间号，只有楼层 + 区域 */
export function locationLabel(c: any): string {
  if (c.targetRoom) {
    const f = c.targetRoom.floor;
    return f ? `${f.building.code}栋 ${f.level}层 ${c.targetRoom.code}` : c.targetRoom.code;
  }
  if (c.targetFloor) {
    const area = c.targetArea ? ` ${c.targetArea}` : '';
    return `${c.targetFloor.building.code}栋 ${c.targetFloor.level}层${area}（公共区域）`;
  }
  return c.targetArea ?? '未指定位置';
}

export const COMPLAINT_INCLUDE = {
  type: true,
  complainant: {
    include: {
      department: true,
      occupancies: {
        where: { status: { in: ['ACTIVE', 'HELD', 'RESERVED'] } },
        include: { bed: { include: { room: true } } },
        take: 1,
      },
    },
  },
  targetRoom: { include: { floor: { include: { building: true } } } },
  targetFloor: { include: { building: true } },
  attachments: true,
};

/**
 * 提交前的防滥用检查。
 *
 * 匿名不等于无限。没有这两道闸，一定会有人拿匿名投诉刷同一个房间泄愤，
 * 而宿管分不清「三个人独立反映」和「一个人投了三次」。
 */
export async function checkAbuse(
  personId: number,
  targetRoomId: number | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [dailyLimit, cooldownHours] = await Promise.all([
    getSetting<number>('complaint.dailyLimit', 3),
    getSetting<number>('complaint.targetCooldownHours', 24),
  ]);

  const since = new Date(Date.now() - 86400000);
  const todayCount = await prisma.complaint.count({
    where: { complainantId: personId, submittedAt: { gte: since } },
  });
  if (todayCount >= dailyLimit) {
    return { ok: false, error: `24 小时内最多提交 ${dailyLimit} 条投诉，请明天再来或直接联系宿管` };
  }

  if (targetRoomId) {
    const cooldownSince = new Date(Date.now() - cooldownHours * 3600000);
    const repeat = await prisma.complaint.findFirst({
      where: {
        complainantId: personId,
        targetRoomId,
        submittedAt: { gte: cooldownSince },
        status: { notIn: ['WITHDRAWN'] },
      },
      orderBy: { submittedAt: 'desc' },
    });
    if (repeat) {
      return {
        ok: false,
        error: `你在 ${cooldownHours} 小时内已经投诉过该房间（${repeat.code}），请等待处理结果`,
      };
    }
  }

  return { ok: true };
}

/**
 * 找出反映同一件事的其它投诉。
 *
 * 这个信号几乎是白捡的，但价值很大：
 *   三个不同房间独立反映 A-305 半夜喧哗 → 基本可以直接认定，优先级拉高
 *   一个人反复投诉 A-305 五次 → 更可能是私人矛盾，要先查关系
 * 前者按「不同投诉人数」判，后者按「同一投诉人条数」判。
 */
export async function findRelated(c: {
  id: number;
  typeId: number;
  targetRoomId: number | null;
  occurredFrom: Date;
}) {
  if (!c.targetRoomId) return { rows: [], distinctComplainants: 0 };
  const windowDays = await getSetting<number>('complaint.relatedWindowDays', 3);
  const from = new Date(c.occurredFrom.getTime() - windowDays * 86400000);
  const to = new Date(c.occurredFrom.getTime() + windowDays * 86400000);

  const rows = await prisma.complaint.findMany({
    where: {
      id: { not: c.id },
      targetRoomId: c.targetRoomId,
      typeId: c.typeId,
      occurredFrom: { gte: from, lte: to },
      status: { notIn: ['WITHDRAWN'] },
    },
    include: { type: true },
    orderBy: { submittedAt: 'desc' },
    take: 20,
  });

  const all = await prisma.complaint.findMany({
    where: {
      targetRoomId: c.targetRoomId,
      typeId: c.typeId,
      occurredFrom: { gte: from, lte: to },
      status: { notIn: ['WITHDRAWN'] },
    },
    select: { complainantId: true },
  });
  const distinctComplainants = new Set(all.map((x) => x.complainantId)).size;

  return {
    // 关联投诉里同样不能泄漏匿名投诉人 —— 这里干脆一律不返回投诉人字段
    rows: rows.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      anonymous: r.anonymous,
      occurredFrom: r.occurredFrom,
      submittedAt: r.submittedAt,
      description: r.description,
    })),
    distinctComplainants,
  };
}

/** 写一条处理流水 */
export async function logEvent(
  complaintId: number,
  type: string,
  operator: string,
  note?: string,
  visibleToComplainant = false
) {
  await prisma.complaintEvent.create({
    data: { complaintId, type, operator, note, visibleToComplainant },
  });
}
