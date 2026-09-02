/**
 * 排宿规则引擎
 *
 * 所有规则都是「可配置」的：每条规则有三档 —— OFF 关闭 / SOFT 只提醒 / HARD 强制拦截。
 * 默认值见 prisma/seed.ts 里的 SettingItem，管理员可在「设置 → 排宿规则」里随时改，
 * 不需要改代码、不需要重启。
 */

export type RuleMode = 'OFF' | 'SOFT' | 'HARD';

export interface RuleConfig {
  gender: RuleMode; // 男女不得同房
  nationality: RuleMode; // 国籍需符合楼层/楼栋归属
  positionRank: RuleMode; // 房型职级门槛（干部房/专家公寓）
  shift: RuleMode; // 同房间尽量同班次
  department: RuleMode; // 同房间尽量同部门
  contractor: RuleMode; // 自有员工与承包商工人不混住
  capacity: RuleMode; // 不得超过房间核定人数
  roomStatus: RuleMode; // 房间须处于可用状态
}

export const DEFAULT_RULES: RuleConfig = {
  gender: 'HARD',
  nationality: 'SOFT', // 默认软约束 —— 因为确实存在同楼混住的情况
  positionRank: 'HARD',
  shift: 'SOFT',
  department: 'SOFT',
  contractor: 'SOFT',
  capacity: 'HARD',
  roomStatus: 'HARD',
};

export interface RuleCheck {
  rule: keyof RuleConfig;
  mode: RuleMode;
  ok: boolean;
  message: string;
}

/** 空间上的策略是逐级继承的：房间 > 楼层 > 楼栋 */
export function resolvePolicy<T>(room: T | null, floor: T | null, building: T | null): T | null {
  if (room !== null && room !== undefined && room !== ('MIXED' as unknown as T)) return room;
  if (floor !== null && floor !== undefined && floor !== ('MIXED' as unknown as T)) return floor;
  if (building !== null && building !== undefined && building !== ('MIXED' as unknown as T))
    return building;
  return null;
}

export interface PersonLike {
  id: number;
  name: string;
  gender: string;
  nationalityId: string;
  departmentId: number;
  positionLevelId: number;
  shiftId: number | null;
  contractorId: number;
  positionRank: number;
  contractorIsSelf: boolean;
}

export interface TargetContext {
  roomStatus: string;
  roomCapacity: number;
  currentOccupantCount: number;
  genderPolicy: string | null; // 已按 房间>楼层>楼栋 解析
  nationalityId: string | null; // 已按 房间>楼层>楼栋 解析
  minPositionRank: number | null;
  roomTypeName: string;
  /** 房内现有住户（用于软约束：班次/部门/雇佣主体是否一致） */
  occupants: Array<{
    shiftId: number | null;
    departmentId: number;
    contractorIsSelf: boolean;
    gender: string;
    nationalityId: string;
  }>;
}

/**
 * 评估把 person 放进这个床位是否合适。
 * 返回全部检查项；调用方按 mode 决定是拦截（HARD 且 !ok）还是仅提醒（SOFT 且 !ok）。
 */
export function evaluateAssignment(
  person: PersonLike,
  ctx: TargetContext,
  rules: RuleConfig = DEFAULT_RULES
): RuleCheck[] {
  const checks: RuleCheck[] = [];
  const add = (rule: keyof RuleConfig, ok: boolean, message: string) => {
    if (rules[rule] === 'OFF') return;
    checks.push({ rule, mode: rules[rule], ok, message });
  };

  // 房间状态
  add(
    'roomStatus',
    ctx.roomStatus === 'AVAILABLE',
    ctx.roomStatus === 'AVAILABLE' ? '房间状态可用' : `房间当前状态为「${ctx.roomStatus}」，不可入住`
  );

  // 核定人数
  add(
    'capacity',
    ctx.currentOccupantCount < ctx.roomCapacity,
    ctx.currentOccupantCount < ctx.roomCapacity
      ? `在住 ${ctx.currentOccupantCount}/${ctx.roomCapacity} 人`
      : `房间已达核定人数 ${ctx.roomCapacity} 人`
  );

  // 性别
  const genderOk =
    !ctx.genderPolicy || ctx.genderPolicy === 'MIXED' || ctx.genderPolicy === person.gender;
  const roommateGenderOk = ctx.occupants.every((o) => o.gender === person.gender);
  add(
    'gender',
    genderOk && roommateGenderOk,
    genderOk && roommateGenderOk
      ? '性别符合'
      : !genderOk
        ? `该区域限 ${ctx.genderPolicy === 'MALE' ? '男性' : '女性'} 入住`
        : '房内已有异性住户'
  );

  // 国籍归属
  const natOk = !ctx.nationalityId || ctx.nationalityId === person.nationalityId;
  add(
    'nationality',
    natOk,
    natOk ? '国籍符合该区域归属' : `该区域归属国籍为 ${ctx.nationalityId}，与本人不一致`
  );

  // 职级门槛
  const rankOk = ctx.minPositionRank === null || person.positionRank >= ctx.minPositionRank;
  add(
    'positionRank',
    rankOk,
    rankOk ? '职级符合房型要求' : `「${ctx.roomTypeName}」有职级门槛，本人职级不足`
  );

  // 班次（软）
  const shiftOk =
    ctx.occupants.length === 0 ||
    person.shiftId === null ||
    ctx.occupants.every((o) => o.shiftId === null || o.shiftId === person.shiftId);
  add('shift', shiftOk, shiftOk ? '与室友班次一致' : '与室友班次不同，作息会互相干扰');

  // 部门（软）
  const deptOk =
    ctx.occupants.length === 0 || ctx.occupants.some((o) => o.departmentId === person.departmentId);
  add('department', deptOk, deptOk ? '房内有同部门同事' : '房内无同部门同事');

  // 雇佣主体（软）
  const conOk =
    ctx.occupants.length === 0 ||
    ctx.occupants.every((o) => o.contractorIsSelf === person.contractorIsSelf);
  add('contractor', conOk, conOk ? '雇佣主体一致' : '自有员工与承包商工人混住');

  return checks;
}

export function splitChecks(checks: RuleCheck[]) {
  return {
    blockers: checks.filter((c) => c.mode === 'HARD' && !c.ok),
    warnings: checks.filter((c) => c.mode === 'SOFT' && !c.ok),
    passed: checks.filter((c) => c.ok),
  };
}
