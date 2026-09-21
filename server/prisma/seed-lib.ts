/**
 * 种子脚本的共享工具层。
 *
 * 关键点：随机数流 rnd 是**模块级单例**，seed-imip 和 seed-demo 共用同一个流。
 * ES 模块天然是单例，所以只要调用顺序不变，拆分前后生成的数据就完全一致。
 * 各模块各自 new 一个 mulberry32 会让序列错位，数据对不上——不要那么做。
 */
import type { PrismaClient } from '@prisma/client';

export const RNG_SEED = 20260902;

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rnd = mulberry32(RNG_SEED);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
export const randInt = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
export const chance = (p: number) => rnd() < p;

export function weighted<T>(weights: readonly (readonly [T, number])[]): T {
  const total = weights.reduce((s, w) => s + w[1], 0);
  let r = rnd() * total;
  for (const [v, w] of weights) { r -= w; if (r <= 0) return v; }
  return weights[weights.length - 1][0];
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
export const daysAhead = (n: number) => new Date(Date.now() + n * 86400000);

/** SQLite 有参数上限，大批量写入要分片 */
export async function createManyChunked(model: any, rows: any[], size = 400) {
  for (let i = 0; i < rows.length; i += size) {
    await model.createMany({ data: rows.slice(i, i + size) });
  }
}

/** 清库顺序：必须先删引用方再删被引用方，否则外键约束会挡住 */
export const WIPE_ORDER = [
  'auditLog', 'notification', 'notificationTemplate', 'syncLog', 'identityBinding', 'integration',
  'complaintAttachment', 'complaintEvent', 'complaint',
  'inspectionItem', 'inspection', 'visitor', 'violation', 'workOrder',
  'deposit', 'issuedItem', 'request', 'occupancyEvent', 'occupancy',
  'relationship', 'person', 'asset', 'bed', 'room', 'floor',
  'userBuilding', 'user', 'role', 'building', 'site', 'device',
  'announcement', 'complaintType', 'workOrderCategory', 'violationType', 'itemType',
  'roomType', 'contractor', 'shift', 'religion', 'positionLevel',
  'department', 'nationality', 'settingItem',
] as const;

/**
 * 清空全部业务数据。
 *
 * 只给种子脚本用。开通新客户时库本来就是空的，这里是空跑；
 * 重置开发库时才真正删东西。**不要在任何运行时代码里调用它。**
 */
export async function wipeAll(prisma: PrismaClient) {
  for (const m of WIPE_ORDER) await (prisma as any)[m].deleteMany();
}

/** 字典查出来之后的常用索引，空间与演示数据模块都要用 */
export interface Dict {
  depts: any[]; levels: any[]; shifts: any[]; contractors: any[]; religions: any[];
  roomTypes: any[]; itemTypes: any[]; violationTypes: any[]; woCategories: any[]; roles: any[];
  rtByCode: Record<string, any>;
  lvByCode: Record<string, any>;
  relByCode: Record<string, any>;
}

/** 空间生成之后传给演示数据模块的东西 */
export interface Space {
  site: any;
  buildingIds: Record<string, number>;
  roomRows: any[];
  bedRows: any[];
  allRoomsFull: any[];
}
