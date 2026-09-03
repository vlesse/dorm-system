/**
 * 排宿规则引擎
 *
 * 每条规则三档：OFF 关闭 / SOFT 只提醒 / HARD 强制拦截。
 * 默认值见 prisma/seed.ts 的 SettingItem，管理员在「设置 → 排宿规则」里随时改，
 * 不用改代码、不用重启。HARD 规则连 force 也越不过去。
 */

export type RuleMode = 'OFF' | 'SOFT' | 'HARD';

export interface RuleConfig {
  roomStatus: RuleMode;    // 房间须处于可用状态
  residential: RuleMode;   // 功能房（洗衣房/祷告室…）不得住人
  capacity: RuleMode;      // 不得超过核定人数
  bedUsable: RuleMode;     // 床位须可用（撤除/维修的床不能分）
  gender: RuleMode;        // 男女不得同房（夫妻房/家庭房除外）
  couple: RuleMode;        // 夫妻房只能住已核验的配偶
  dependent: RuleMode;     // 家属只能住允许家属的房型，且须与挂靠员工同房
  positionRank: RuleMode;  // 房型职级门槛
  bunk: RuleMode;          // 不能睡上铺的人不分上铺
  accessibility: RuleMode; // 行动不便的人需低楼层或有电梯
  nationality: RuleMode;   // 国籍需符合区域归属
  shift: RuleMode;         // 同房间尽量同班次
  department: RuleMode;    // 同房间尽量同部门
  contractor: RuleMode;    // 自有员工与承包商工人不混住
  religion: RuleMode;      // 有饮食禁忌的尽量同住（清真）
  smoking: RuleMode;       // 吸烟与不吸烟尽量不同住
  language: RuleMode;      // 房内至少有语言相通的人
}

export const DEFAULT_RULES: RuleConfig = {
  roomStatus: 'HARD',
  residential: 'HARD',
  capacity: 'HARD',
  bedUsable: 'HARD',
  gender: 'HARD',
  couple: 'HARD',
  dependent: 'HARD',
  positionRank: 'HARD',
  bunk: 'HARD',
  accessibility: 'SOFT',
  nationality: 'SOFT', // 默认软约束 —— 确实存在同楼混住
  shift: 'SOFT',
  department: 'SOFT',
  contractor: 'SOFT',
  religion: 'SOFT',
  smoking: 'SOFT',
  language: 'SOFT',
};

/** 规则说明，前端设置页直接用 */
export const RULE_META: Record<keyof RuleConfig, { zh: string; id: string; en: string; hint: string }> = {
  roomStatus:  { zh: '房间须可用', id: 'Kamar Harus Tersedia', en: 'Room Must Be Available', hint: '维修 / 隔离 / 封锁 / 待清洁的房间不能进人。' },
  residential: { zh: '功能房不得住人', id: 'Ruang Fungsional Bukan Hunian', en: 'Non-residential Rooms', hint: '洗衣房、祷告室、宿管室这类功能房占楼层空间但不住人。' },
  capacity:    { zh: '不得超过核定人数', id: 'Tidak Melebihi Kapasitas', en: 'Do Not Exceed Capacity', hint: '按房间的「核定人数」算，不是按房型标称。四人间核定 3 人就是 3 人。' },
  bedUsable:   { zh: '床位须可用', id: 'Tempat Tidur Tersedia', en: 'Bed Must Be Usable', hint: '降标撤除、报修中的床位不能分配。' },
  gender:      { zh: '男女不同房', id: 'Pisah Gender', en: 'Gender Separation', hint: '夫妻房 / 家庭房自动豁免。建议保持「强制拦截」。' },
  couple:      { zh: '夫妻房须配偶关系', id: 'Kamar Pasangan Suami Istri', en: 'Couple Room Requires Spouse', hint: '夫妻房只能住已登记且已核验（结婚证）的配偶两人。' },
  dependent:   { zh: '家属随迁限制', id: 'Aturan Keluarga', en: 'Dependent Rules', hint: '家属只能住允许家属的房型，且必须与挂靠员工同一房间。' },
  positionRank:{ zh: '房型职级门槛', id: 'Syarat Jenjang Jabatan', en: 'Position Rank Requirement', hint: '干部单间、专家公寓有职级门槛。' },
  bunk:        { zh: '上下铺限制', id: 'Aturan Ranjang Susun', en: 'Bunk Restriction', hint: '标记了「不能睡上铺」的人（年龄 / 体重 / 身体原因）不分上铺，这是安全问题。' },
  accessibility:{ zh: '无障碍需求', id: 'Kebutuhan Aksesibilitas', en: 'Accessibility', hint: '行动不便的人安排在三层以下，或安排在有电梯的楼。' },
  nationality: { zh: '国籍符合区域归属', id: 'Sesuai Zona Kewarganegaraan', en: 'Nationality Zoning', hint: '默认「仅提醒」，因为确实存在同楼混住。' },
  shift:       { zh: '同房同班次', id: 'Sif Sama Sekamar', en: 'Same Shift per Room', hint: '白班夜班混住是宿舍矛盾第一来源。' },
  department:  { zh: '同房同部门', id: 'Departemen Sama Sekamar', en: 'Same Department per Room', hint: '便于紧急集合、班车和交接。' },
  contractor:  { zh: '自有与承包商不混住', id: 'Pisah Karyawan & Kontraktor', en: 'Separate Contractor Staff', hint: '费用结算主体不同，管理责任也不同。' },
  religion:    { zh: '饮食禁忌一致', id: 'Kesesuaian Aturan Makanan', en: 'Dietary Compatibility', hint: '有清真等饮食禁忌的员工尽量同住，避免共用炊具引发矛盾。' },
  smoking:     { zh: '吸烟习惯一致', id: 'Kebiasaan Merokok', en: 'Smoking Preference', hint: '宿舍抽烟既是矛盾来源也是火灾风险。' },
  language:    { zh: '房内语言可沟通', id: 'Bahasa Dapat Berkomunikasi', en: 'Shared Language', hint: '混住房间里至少要有能互相沟通的人，紧急情况才喊得动。' },
};

export interface RuleCheck {
  rule: keyof RuleConfig;
  mode: RuleMode;
  ok: boolean;
  message: string;
}

export interface PersonLike {
  id: number;
  name: string;
  personType: string; // EMPLOYEE / DEPENDENT / VISITOR / INTERN
  gender: string;
  nationalityId: string;
  departmentId: number | null;
  positionLevelId: number | null;
  shiftId: number | null;
  contractorId: number | null;
  religionId: number | null;
  hasDietaryRule: boolean;
  isSmoker: boolean;
  needsLowerBunk: boolean;
  needsGroundFloor: boolean;
  languages: string[]; // ['zh','id']
  positionRank: number;
  contractorIsSelf: boolean;
  /** 已核验的配偶 id 列表 */
  spouseIds: number[];
  /** 家属挂靠的员工 id */
  hostPersonId: number | null;
  /** 该职级是否允许申请夫妻房 */
  coupleRoomAllowed: boolean;
}

export interface OccupantLike {
  personId: number;
  gender: string;
  nationalityId: string;
  departmentId: number | null;
  shiftId: number | null;
  contractorIsSelf: boolean;
  hasDietaryRule: boolean;
  isSmoker: boolean;
  languages: string[];
  hostPersonId: number | null;
}

export interface TargetContext {
  roomStatus: string;
  /** 核定人数（Room.capacity），不是房型标称 */
  roomCapacity: number;
  currentOccupantCount: number;
  genderPolicy: string | null; // 已按 房间 > 楼层 > 楼栋 解析
  nationalityId: string | null;
  minPositionRank: number | null;
  roomTypeName: string;
  isResidential: boolean;
  isCoupleRoom: boolean;
  allowMixedGender: boolean;
  allowDependents: boolean;
  /** 目标床位信息（不传则跳过床位级检查） */
  bedPosition?: string; // UPPER / LOWER / SINGLE
  bedStatus?: string;
  floorLevel: number;
  buildingHasElevator: boolean;
  occupants: OccupantLike[];
}

const overlap = (a: string[], b: string[]) => a.some((x) => b.includes(x));

/**
 * 评估把 person 放进这个床位是否合适。
 * 返回全部检查项；调用方按 mode 决定拦截（HARD 且 !ok）还是仅提醒（SOFT 且 !ok）。
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

  // —— 房间可用性 ——
  add('roomStatus', ctx.roomStatus === 'AVAILABLE',
    ctx.roomStatus === 'AVAILABLE' ? '房间状态可用' : `房间当前状态为「${ctx.roomStatus}」，不可入住`);

  add('residential', ctx.isResidential,
    ctx.isResidential ? '住宿用房' : `「${ctx.roomTypeName}」是功能房，不住人`);

  add('capacity', ctx.currentOccupantCount < ctx.roomCapacity,
    ctx.currentOccupantCount < ctx.roomCapacity
      ? `在住 ${ctx.currentOccupantCount}/${ctx.roomCapacity}（核定人数）`
      : `已达核定人数 ${ctx.roomCapacity} 人`);

  if (ctx.bedStatus !== undefined) {
    const bedOk = ctx.bedStatus === 'FREE';
    add('bedUsable', bedOk, bedOk ? '床位可用'
      : ctx.bedStatus === 'DISABLED' ? '该床位已按降标撤除，不可分配'
      : `床位状态为「${ctx.bedStatus}」，不可分配`);
  }

  // —— 性别 ——
  if (ctx.allowMixedGender) {
    add('gender', true, `「${ctx.roomTypeName}」允许男女同住`);
  } else {
    const zoneOk = !ctx.genderPolicy || ctx.genderPolicy === 'MIXED' || ctx.genderPolicy === person.gender;
    const mateOk = ctx.occupants.every((o) => o.gender === person.gender);
    add('gender', zoneOk && mateOk,
      zoneOk && mateOk ? '性别符合'
        : !zoneOk ? `该区域限 ${ctx.genderPolicy === 'MALE' ? '男性' : '女性'} 入住`
        : '房内已有异性住户');
  }

  // —— 夫妻房 ——
  if (ctx.isCoupleRoom) {
    if (!person.coupleRoomAllowed && person.personType === 'EMPLOYEE') {
      add('couple', false, '该职级尚未开放夫妻房申请（可在「设置 → 职级」调整）');
    } else if (ctx.occupants.length === 0) {
      const hasSpouse = person.spouseIds.length > 0;
      add('couple', hasSpouse, hasSpouse ? '已登记核验配偶，可入住夫妻房'
        : '未登记（或未核验）配偶关系，不能入住夫妻房');
    } else if (ctx.occupants.length === 1) {
      const mate = ctx.occupants[0];
      const isSpouse = person.spouseIds.includes(mate.personId);
      add('couple', isSpouse, isSpouse ? '与在住者为已核验配偶'
        : '夫妻房内已有住户，且与本人不是已核验的配偶关系');
    } else {
      add('couple', false, '夫妻房已住满两人');
    }
  } else if (person.spouseIds.length > 0 && ctx.occupants.some((o) => person.spouseIds.includes(o.personId))) {
    add('couple', true, '与配偶同住（非夫妻房，建议调至夫妻房）');
  }

  // —— 家属随迁 ——
  if (person.personType === 'DEPENDENT' || person.personType === 'VISITOR') {
    if (!ctx.allowDependents) {
      add('dependent', false, `「${ctx.roomTypeName}」不允许家属 / 访客入住`);
    } else if (person.hostPersonId === null) {
      add('dependent', false, '该家属未挂靠员工，无法安排住宿');
    } else {
      const withHost = ctx.occupants.some((o) => o.personId === person.hostPersonId);
      add('dependent', withHost || ctx.occupants.length === 0,
        withHost ? '与挂靠员工同房'
          : ctx.occupants.length === 0 ? '空房，挂靠员工需一并安排至本房'
          : '家属必须与挂靠员工住同一房间');
    }
  }

  // —— 职级门槛 ——
  const rankOk = ctx.minPositionRank === null || person.positionRank >= ctx.minPositionRank;
  add('positionRank', rankOk, rankOk ? '职级符合房型要求'
    : `「${ctx.roomTypeName}」有职级门槛，本人职级不足`);

  // —— 上下铺 ——
  if (ctx.bedPosition) {
    const bunkOk = !(person.needsLowerBunk && ctx.bedPosition === 'UPPER');
    add('bunk', bunkOk, bunkOk ? '铺位符合' : '本人标记为「不能睡上铺」，不可分配上铺');
  }

  // —— 无障碍 ——
  if (person.needsGroundFloor) {
    const accOk = ctx.floorLevel <= 3 || ctx.buildingHasElevator;
    add('accessibility', accOk, accOk ? '楼层符合无障碍需求'
      : `本人行动不便，${ctx.floorLevel} 层且该楼无电梯`);
  }

  // —— 国籍归属 ——
  const natOk = !ctx.nationalityId || ctx.nationalityId === person.nationalityId;
  add('nationality', natOk, natOk ? '国籍符合该区域归属'
    : `该区域归属国籍为 ${ctx.nationalityId}，与本人不一致`);

  // —— 以下为室友相关的软约束 ——
  const mates = ctx.occupants;

  const shiftOk = mates.length === 0 || person.shiftId === null ||
    mates.every((o) => o.shiftId === null || o.shiftId === person.shiftId);
  add('shift', shiftOk, shiftOk ? '与室友班次一致' : '与室友班次不同，作息会互相干扰');

  const deptOk = mates.length === 0 || person.departmentId === null ||
    mates.some((o) => o.departmentId === person.departmentId);
  add('department', deptOk, deptOk ? '房内有同部门同事' : '房内无同部门同事');

  const conOk = mates.length === 0 || mates.every((o) => o.contractorIsSelf === person.contractorIsSelf);
  add('contractor', conOk, conOk ? '雇佣主体一致' : '自有员工与承包商工人混住');

  const dietOk = mates.length === 0 || mates.every((o) => o.hasDietaryRule === person.hasDietaryRule);
  add('religion', dietOk, dietOk ? '饮食习惯一致'
    : '与室友饮食禁忌不同（清真 / 非清真），共用炊具易起矛盾');

  const smokeOk = mates.length === 0 || mates.every((o) => o.isSmoker === person.isSmoker);
  add('smoking', smokeOk, smokeOk ? '吸烟习惯一致' : '与室友吸烟习惯不同');

  const langOk = mates.length === 0 || person.languages.length === 0 ||
    mates.some((o) => o.languages.length === 0 || overlap(o.languages, person.languages));
  add('language', langOk, langOk ? '房内语言可沟通' : '房内无语言相通的室友，紧急情况难沟通');

  return checks;
}

export function splitChecks(checks: RuleCheck[]) {
  return {
    blockers: checks.filter((c) => c.mode === 'HARD' && !c.ok),
    warnings: checks.filter((c) => c.mode === 'SOFT' && !c.ok),
    passed: checks.filter((c) => c.ok),
  };
}

/** 空间策略逐级继承：房间 > 楼层 > 楼栋 */
export function inherit<T>(...levels: (T | null | undefined)[]): T | null {
  for (const v of levels) if (v !== null && v !== undefined) return v;
  return null;
}

/**
 * 候选床位打分。seed 批量排宿和 API 推荐共用同一套，保证两边口径一致。
 * 分数只影响「推荐顺序」，不影响能不能住 —— 能不能住由上面的硬约束决定。
 */
export function scoreAssignment(
  person: PersonLike,
  ctx: TargetContext,
  warningCount: number,
  bedPosition?: string
): number {
  let score = 100 - warningCount * 10;

  // 国籍与区域归属一致
  if (ctx.nationalityId && ctx.nationalityId === person.nationalityId) score += 25;

  // 房型与职级匹配：有门槛的房型给够权重，否则干部会被塞进大间
  if (ctx.minPositionRank !== null && person.positionRank >= ctx.minPositionRank) {
    score += 50 + (ctx.minPositionRank - person.positionRank >= 0 ? 0 : 0);
  }
  // 中层及以上不该住 4 人以上的大间
  if (person.positionRank >= 40 && ctx.roomCapacity >= 4) score -= 45;
  // 工程师、科长优先双人 / 三人间
  if (person.positionRank >= 20 && person.positionRank < 40 && ctx.roomCapacity >= 6) score -= 12;

  // 夫妻房：有已核验配偶的强烈优先，没有的强烈回避
  if (ctx.isCoupleRoom) score += person.spouseIds.length > 0 ? 60 : -100;

  // 已开住的房间优先填满，减少碎片
  if (ctx.currentOccupantCount > 0) score += 8;

  // 铺位偏好
  if (bedPosition === 'LOWER' && person.needsLowerBunk) score += 15;
  if (bedPosition === 'UPPER' && person.needsLowerBunk) score -= 100;

  // 无障碍需求：低楼层加分
  if (person.needsGroundFloor) score += Math.max(0, 20 - ctx.floorLevel * 4);

  return score;
}
