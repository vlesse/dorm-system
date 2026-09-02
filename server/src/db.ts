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
