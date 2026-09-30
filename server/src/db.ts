import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** 读取排宿规则配置（存在 SettingItem 里，随时可改） */
export async function loadRules() {
  const row = await prisma.settingItem.findUnique({ where: { key: 'allocation.rules' } });
  const { DEFAULT_RULES } = await import('./services/rules.js');
  if (!row) return DEFAULT_RULES;
  try {
    return { ...DEFAULT_RULES, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_RULES;
  }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.settingItem.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

/**
 * 分页参数。`?page=abc` 这种会变成 NaN 传给 Prisma 直接 500，这里统一兜住。
 */
export function paging(q: Record<string, any>, defaultSize = 20, maxSize = 200) {
  const page = Math.max(1, Math.floor(Number(q.page)) || 1);
  const pageSize = Math.min(Math.max(1, Math.floor(Number(q.pageSize)) || defaultSize), maxSize);
  return { page, pageSize };
}
