/**
 * 演示数据 —— **只给演示站和本地开发用，绝不要在真实客户的库里跑。**
 *
 * 生成 2500 名员工、家属随迁、排宿、物品押金、工单、违规、投诉、访客、
 * 查寝、申请、公告、设备占位，以及故意制造的脏数据（离职未退宿 18 条），
 * 用来验证系统在真实运营状态下的表现。
 *
 * 规模比例在下面的常量里，随时可调。随机数流来自 seed-lib，跨模块共用同一个流。
 */
import type { PrismaClient } from '@prisma/client';
import { seedPlatform } from './seed-platform.js';
import { BUILDINGS } from './seed-imip.js';
import {
  rnd, pick, randInt, chance, weighted, daysAgo, daysAhead, createManyChunked,
} from './seed-lib.js';
import type { Dict, Space } from './seed-lib.js';

// ---------------------------------------------------------------- 可调参数
const TOTAL_EMPLOYEES = 2500;
const COUPLE_BOTH_EMPLOYEE = 45; // 夫妻双职工对数
const COUPLE_WITH_DEPENDENT = 40; // 配偶为家属（非员工）的对数
const CHILD_DEPENDENTS = 18; // 随迁子女
const TARGET_OCCUPANCY = 0.87;
const RESIGNED_STILL_HOLDING_BED = 18; // 故意制造的「离职未退宿」脏数据

// ---------------------------------------------------------------- 姓名池
const CN_SURNAME = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严武戴莫孔向汤'.split('');
const CN_GIVEN_M = ['伟','强','磊','军','洋','勇','杰','涛','明','超','刚','建国','志强','建华','文华','建军','国强','海涛','宇航','浩然','天佑','俊杰','晓东','立新','振华','永强','小龙','世豪','鹏飞','金龙','德山','忠诚','兴旺','大勇','广良','传军','庆华','守义','运来','长江'];
const CN_GIVEN_F = ['芳','娜','秀英','敏','静','丽','艳','娟','霞','平','桂英','小红','雪梅','丹丹','晓燕','玉兰','秀兰','海燕','春燕','文静','美玲','桂芳','秋月'];
const ID_GIVEN_M = ['Budi','Agus','Joko','Andi','Bambang','Dedi','Eko','Hendra','Rudi','Slamet','Wahyu','Yusuf','Ahmad','Muhammad','Iwan','Fajar','Rizki','Dwi','Tri','Adi','Anwar','Bayu','Candra','Dani','Firman','Gunawan','Hadi','Imam','Jaya','Krisna','Lukman','Nanda','Oki','Putra','Rahmat','Surya','Taufik','Umar','Vino','Yanto'];
const ID_GIVEN_F = ['Siti','Dewi','Sri','Rina','Ayu','Indah','Lestari','Nurul','Wati','Yuni','Fitri','Ratna','Maya','Putri','Anisa','Melati','Kartika','Wulan','Intan','Rahma'];
const ID_SURNAME = ['Santoso','Wijaya','Saputra','Pratama','Nugroho','Setiawan','Hidayat','Kurniawan','Susanto','Permana','Ramadhan','Maulana','Firdaus','Sari','Anggraini','Halim','Tanjung','Simatupang','Manurung','Pangestu'];
const KR_NAME = ['Kim Min-jun','Lee Ji-ho','Park Seo-jun','Choi Woo-jin','Jung Ha-eun','Kang Dae-hyun','Yoon Seok-ho','Lim Jae-min'];
const DE_NAME = ['Lukas Müller','Jonas Schmidt','Felix Weber','Klaus Fischer','Markus Wagner','Stefan Becker'];
const VN_NAME = ['Nguyen Van Hung','Tran Minh Tuan','Le Thi Lan','Pham Quoc Anh','Hoang Van Nam','Vu Duc Manh'];

function makeName(natId: string, gender: string) {
  if (natId === 'CN') return pick(CN_SURNAME) + (gender === 'MALE' ? pick(CN_GIVEN_M) : pick(CN_GIVEN_F));
  if (natId === 'ID') return `${gender === 'MALE' ? pick(ID_GIVEN_M) : pick(ID_GIVEN_F)} ${pick(ID_SURNAME)}`;
  if (natId === 'KR') return pick(KR_NAME);
  if (natId === 'DE') return pick(DE_NAME);
  return pick(VN_NAME);
}

// ---------------------------------------------------------------- 楼栋配置
interface BuildingCfg {
  code: string; name: string;
  gender: 'MALE' | 'FEMALE' | 'MIXED';
  nationality: string | null;
  floors: number; roomsPerFloor: number;
  hasElevator?: boolean;
  floorNationality?: Record<number, string | null>;
  mix: Record<string, number>;
  note?: string;
}

export async function seedDemo(prisma: PrismaClient, dict: Dict, space: Space) {
  const {
    depts, levels, shifts, contractors, religions,
    itemTypes, violationTypes, woCategories, roles,
    rtByCode, lvByCode, relByCode,
  } = dict;
  const { buildingIds, roomRows, bedRows, allRoomsFull } = space;

  const natWeights = [['ID', 0.6], ['CN', 0.355], ['KR', 0.015], ['DE', 0.01], ['VN', 0.02]] as const;
  const lvWeights = [['WORKER', 0.72], ['ENGINEER', 0.15], ['SECTION', 0.07], ['DIVISION', 0.035], ['MANAGER', 0.019], ['GM', 0.006]] as const;
  const statusWeights = [['ACTIVE', 0.84], ['ON_LEAVE', 0.07], ['BUSINESS_TRIP', 0.03], ['HOSPITALIZED', 0.005], ['RESIGNED', 0.055]] as const;

  function religionFor(natId: string) {
    if (natId === 'ID') return relByCode[weighted([['ISLAM', 0.87], ['CHRISTIAN', 0.07], ['CATHOLIC', 0.03], ['HINDU', 0.02], ['BUDDHIST', 0.01]] as const)];
    if (natId === 'CN') return relByCode[weighted([['NONE', 0.85], ['BUDDHIST', 0.1], ['CHRISTIAN', 0.05]] as const)];
    if (natId === 'VN') return relByCode[weighted([['BUDDHIST', 0.6], ['NONE', 0.4]] as const)];
    return relByCode[weighted([['CHRISTIAN', 0.5], ['NONE', 0.5]] as const)];
  }
  function langsFor(natId: string) {
    const out: string[] = [];
    if (natId === 'CN') { out.push('zh'); if (chance(0.2)) out.push('en'); if (chance(0.15)) out.push('id'); }
    else if (natId === 'ID') { out.push('id'); if (chance(0.2)) out.push('en'); if (chance(0.1)) out.push('zh'); }
    else if (natId === 'KR') { out.push('ko', 'en'); if (chance(0.4)) out.push('zh'); }
    else if (natId === 'DE') { out.push('de', 'en'); }
    else { out.push('vi'); if (chance(0.5)) out.push('zh'); }
    return out.join(',');
  }

  const personRows: any[] = [];
  for (let i = 0; i < TOTAL_EMPLOYEES; i++) {
    const natId = weighted(natWeights);
    const gender = chance(0.07) ? 'FEMALE' : 'MALE';
    const level = lvByCode[weighted(lvWeights)];
    const dept = pick(depts);
    const employmentStatus = weighted(statusWeights);
    const contractor =
      natId === 'ID' && chance(0.35) ? pick(contractors.filter((c) => !c.isSelf && c.code.startsWith('PT')))
      : natId === 'CN' && chance(0.12) ? contractors.find((c) => c.code === 'CN-CONST')!
      : contractors.find((c) => c.isSelf)!;
    const shift =
      level.rank >= 30 || ['HR', 'FIN', 'PROC', 'ADMIN', 'DORM'].includes(dept.code)
        ? shifts.find((s) => s.code === 'ADMIN')!
        : chance(0.5) ? shifts.find((s) => s.code === 'DAY')! : shifts.find((s) => s.code === 'NIGHT')!;
    const cycleDays = Math.round(level.leaveCycleMonths * 30.4);
    const age = randInt(20, 56);

    personRows.push({
      employeeNo: `${natId}${String(100001 + i).slice(1)}`,
      personType: chance(0.02) ? 'INTERN' : 'EMPLOYEE',
      name: makeName(natId, gender),
      gender,
      birthDate: daysAgo(age * 365 + randInt(0, 364)),
      nationalityId: natId,
      idType: natId === 'ID' ? 'KTP' : chance(0.3) ? 'KITAS' : 'PASSPORT',
      idNumber: natId === 'ID'
        ? `72${String(randInt(10000000000000, 99999999999999))}`.slice(0, 16)
        : `${natId[0]}${randInt(10000000, 99999999)}`,
      // 一部分证件即将到期 —— 这是真会出事的地方
      idExpiryDate: natId === 'ID' ? null : chance(0.06) ? daysAhead(randInt(5, 85)) : daysAhead(randInt(120, 1500)),
      passportHeld: natId === 'CN' && chance(0.95),
      departmentId: dept.id,
      positionLevelId: level.id,
      positionTitle: `${dept.nameZh}${level.nameZh}`,
      shiftId: shift.id,
      contractorId: contractor.id,
      religionId: religionFor(natId).id,
      phone: `+62 8${randInt(10, 99)}-${randInt(1000, 9999)}-${randInt(1000, 9999)}`,
      emergencyContact: natId === 'CN' ? pick(CN_SURNAME) + pick(CN_GIVEN_M) : `${pick(ID_GIVEN_M)} ${pick(ID_SURNAME)}`,
      emergencyPhone: `+62 8${randInt(10, 99)}-${randInt(1000, 9999)}-${randInt(1000, 9999)}`,
      languages: langsFor(natId),
      isSmoker: gender === 'MALE' ? (natId === 'ID' ? chance(0.6) : chance(0.5)) : chance(0.05),
      needsLowerBunk: age > 45 ? chance(0.35) : chance(0.03),
      needsGroundFloor: chance(0.015),
      hireDate: daysAgo(randInt(30, 2200)),
      employmentStatus,
      cycleStartDate: daysAgo(randInt(0, cycleDays + 20)),
    });
  }
  await createManyChunked(prisma.person, personRows);

  // —— 夫妻双职工：从同国籍里凑对，登记并核验配偶关系 ——
  const allEmployees = await prisma.person.findMany({
    where: { employmentStatus: { not: 'RESIGNED' } },
    include: { positionLevel: true },
    orderBy: { id: 'asc' },
  });
  const males = allEmployees.filter((p) => p.gender === 'MALE' && p.positionLevel!.coupleRoomAllowed);
  const females = allEmployees.filter((p) => p.gender === 'FEMALE' && p.positionLevel!.coupleRoomAllowed);

  const relRows: any[] = [];
  const couplePairs: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(COUPLE_BOTH_EMPLOYEE, females.length); i++) {
    const f = females[i];
    const m = males.find((x) => x.nationalityId === f.nationalityId && !couplePairs.some((p) => p[0] === x.id));
    if (!m) continue;
    couplePairs.push([m.id, f.id]);
    relRows.push({ personId: m.id, relatedPersonId: f.id, type: 'SPOUSE', verified: true, verifiedBy: 'HR', note: '双职工，已验结婚证' });
  }

  // —— 家属随迁：配偶不是员工，建 DEPENDENT 档案挂靠员工 ——
  const dependentRows: any[] = [];
  const hostCandidates = allEmployees.filter(
    (p) => p.positionLevel!.coupleRoomAllowed && p.gender === 'MALE' && !couplePairs.some((c) => c[0] === p.id)
  );
  const hostsForDependents = hostCandidates.slice(0, COUPLE_WITH_DEPENDENT);
  hostsForDependents.forEach((host, i) => {
    dependentRows.push({
      employeeNo: `DP${String(10001 + i).slice(1)}`,
      personType: 'DEPENDENT',
      name: makeName(host.nationalityId, 'FEMALE'),
      gender: 'FEMALE',
      birthDate: daysAgo(randInt(24, 45) * 365),
      nationalityId: host.nationalityId,
      idType: host.nationalityId === 'ID' ? 'KTP' : 'PASSPORT',
      idNumber: host.nationalityId === 'ID'
        ? `72${String(randInt(10000000000000, 99999999999999))}`.slice(0, 16)
        : `${host.nationalityId[0]}${randInt(10000000, 99999999)}`,
      idExpiryDate: host.nationalityId === 'ID' ? null : daysAhead(randInt(60, 1200)),
      religionId: religionFor(host.nationalityId).id,
      phone: `+62 8${randInt(10, 99)}-${randInt(1000, 9999)}-${randInt(1000, 9999)}`,
      languages: langsFor(host.nationalityId),
      isSmoker: false,
      employmentStatus: 'ACTIVE',
      hostPersonId: host.id,
      note: '家属随迁（配偶）',
    });
  });
  // 随迁子女
  hostsForDependents.slice(0, CHILD_DEPENDENTS).forEach((host, i) => {
    dependentRows.push({
      employeeNo: `DC${String(10001 + i).slice(1)}`,
      personType: 'DEPENDENT',
      name: makeName(host.nationalityId, chance(0.5) ? 'MALE' : 'FEMALE'),
      gender: chance(0.5) ? 'MALE' : 'FEMALE',
      birthDate: daysAgo(randInt(3, 14) * 365),
      nationalityId: host.nationalityId,
      idType: 'OTHER', idNumber: `CH${randInt(100000, 999999)}`,
      religionId: religionFor(host.nationalityId).id,
      languages: langsFor(host.nationalityId),
      employmentStatus: 'ACTIVE',
      hostPersonId: host.id,
      note: '家属随迁（子女）',
    });
  });
  await createManyChunked(prisma.person, dependentRows);

  const dependents = await prisma.person.findMany({ where: { personType: 'DEPENDENT' } });
  for (const d of dependents) {
    if (!d.hostPersonId) continue;
    const isChild = d.employeeNo.startsWith('DC');
    relRows.push({
      personId: d.hostPersonId, relatedPersonId: d.id,
      type: isChild ? 'CHILD' : 'SPOUSE',
      verified: true, verifiedBy: 'HR',
      note: isChild ? '随迁子女' : '随迁配偶，已验结婚证',
    });
    if (!isChild) couplePairs.push([d.hostPersonId, d.id]);
  }
  await createManyChunked(prisma.relationship, relRows);
  console.log(`  员工 ${TOTAL_EMPLOYEES}，家属 ${dependents.length}，已核验配偶关系 ${couplePairs.length} 对`);

  // ============================== 排宿 ==============================
  console.log('按规则排宿…');
  const { evaluateAssignment, splitChecks, scoreAssignment } = await import('../src/services/rules.js');
  const { roomToContext, personToLike } = await import('../src/services/space.js');

  const spouse = new Map<number, number[]>();
  for (const [a, b] of couplePairs) {
    spouse.set(a, [...(spouse.get(a) ?? []), b]);
    spouse.set(b, [...(spouse.get(b) ?? []), a]);
  }

  const roomsFull = await prisma.room.findMany({
    include: {
      roomType: true,
      floor: { include: { building: true } },
      beds: { orderBy: { id: 'asc' }, include: { occupancies: true } },
    },
  });
  // 排宿过程中在内存里维护每间房的住户，避免反复读库
  const ctxState = roomsFull.map((room) => ({
    room,
    freeBeds: room.beds.filter((b) => b.status === 'FREE'),
    occupants: [] as any[],
  }));

  const personsFull = await prisma.person.findMany({
    include: { positionLevel: true, contractor: true, religion: true, department: true, shift: true },
  });
  const byId = new Map(personsFull.map((p) => [p.id, p]));

  const occupancyRows: any[] = [];
  const bedStatus = new Map<number, string>();

  const assignTo = (state: (typeof ctxState)[number], person: any, bed: any, status: string, note?: string) => {
    state.freeBeds = state.freeBeds.filter((b) => b.id !== bed.id);
    state.occupants.push(person);
    occupancyRows.push({
      bedId: bed.id, personId: person.id,
      checkInAt: daysAgo(randInt(1, 900)),
      status, assignedBy: 'seed', note: note ?? null,
    });
    bedStatus.set(bed.id, status === 'HELD' ? 'HELD' : 'OCCUPIED');
  };

  const buildCtx = (state: (typeof ctxState)[number], bed?: any) =>
    roomToContext(
      { ...state.room, beds: [{ occupancies: state.occupants.map((p) => ({ person: p })) }] },
      bed
    );

  const toLike = (p: any) => personToLike(p, spouse.get(p.id) ?? []);

  // 1) 先安排夫妻 / 家属 —— 他们只能进夫妻房和家庭房，位置最紧张
  const coupleRooms = ctxState.filter((s) => s.room.roomType.isCoupleRoom && s.room.status === 'AVAILABLE');
  let coupleIdx = 0;
  let couplesPlaced = 0;
  for (const [aId, bId] of couplePairs) {
    const a = byId.get(aId); const b = byId.get(bId);
    if (!a || !b) continue;
    if (a.employmentStatus === 'RESIGNED') continue;
    // 找一间还空着的夫妻房 / 家庭房
    while (coupleIdx < coupleRooms.length && coupleRooms[coupleIdx].freeBeds.length < 2) coupleIdx++;
    if (coupleIdx >= coupleRooms.length) break;
    const state = coupleRooms[coupleIdx];
    assignTo(state, a, state.freeBeds[0], a.employmentStatus === 'ON_LEAVE' ? 'HELD' : 'ACTIVE');
    assignTo(state, b, state.freeBeds[0], 'ACTIVE', '随配偶入住');
    // 家庭房再塞子女
    if (state.room.roomType.code === 'FAMILY') {
      const kids = personsFull.filter((p) => p.hostPersonId === aId && p.employeeNo.startsWith('DC'));
      for (const kid of kids) {
        if (state.freeBeds.length === 0) break;
        assignTo(state, kid, state.freeBeds[0], 'ACTIVE', '随迁子女');
      }
    }
    couplesPlaced++;
  }

  // 2) 其余人员：职级高的先排，保证干部房 / 专家公寓被正确占用
  const placedIds = new Set(occupancyRows.map((o) => o.personId));
  const queue = personsFull
    .filter((p) => p.employmentStatus !== 'RESIGNED' && !placedIds.has(p.id) && p.personType !== 'DEPENDENT')
    .sort((a, b) => (b.positionLevel?.rank ?? 0) - (a.positionLevel?.rank ?? 0));

  const usableBedTotal = bedRows.filter((b) => b.status === 'FREE').length;
  const targetAssign = Math.floor(usableBedTotal * TARGET_OCCUPANCY);

  const generalRooms = ctxState.filter(
    (s) => s.room.roomType.isResidential && !s.room.roomType.isCoupleRoom && s.room.status === 'AVAILABLE'
  );

  for (const p of queue) {
    if (occupancyRows.length >= targetAssign) break;
    const pl = toLike(p);
    let best: { state: (typeof ctxState)[number]; bed: any; score: number } | null = null;

    for (const state of generalRooms) {
      if (state.freeBeds.length === 0) continue;
      if (state.occupants.length >= state.room.capacity) continue;
      // 先按房间粗筛，再挑铺位
      for (const bed of state.freeBeds.slice(0, 2)) {
        const ctx = buildCtx(state, bed);
        const checks = evaluateAssignment(pl, ctx);
        const { blockers, warnings } = splitChecks(checks);
        if (blockers.length > 0) continue;
        const score = scoreAssignment(pl, ctx, warnings.length, bed.position) + rnd() * 6;
        if (!best || score > best.score) best = { state, bed, score };
      }
    }
    if (!best) continue;
    assignTo(best.state, p, best.bed, p.employmentStatus === 'ON_LEAVE' ? 'HELD' : 'ACTIVE',
      p.employmentStatus === 'ON_LEAVE' ? '休假回国，床位保留' : undefined);
  }

  // 3) 故意留一批「已离职但床位没释放」的脏数据
  const resigned = personsFull.filter((p) => p.employmentStatus === 'RESIGNED');
  let dirty = 0;
  for (const p of resigned) {
    if (dirty >= RESIGNED_STILL_HOLDING_BED) break;
    const state = generalRooms.find(
      (s) => s.freeBeds.length > 0 && s.occupants.length < s.room.capacity &&
        (buildCtx(s).genderPolicy === null || buildCtx(s).genderPolicy === p.gender)
    );
    if (!state) break;
    assignTo(state, p, state.freeBeds[0], 'ACTIVE', '离职未办理退宿');
    dirty++;
  }

  await createManyChunked(prisma.occupancy, occupancyRows);
  const grouped = new Map<string, number[]>();
  for (const [id, st] of bedStatus) {
    if (!grouped.has(st)) grouped.set(st, []);
    grouped.get(st)!.push(id);
  }
  for (const [st, ids] of grouped) {
    for (let i = 0; i < ids.length; i += 400) {
      await prisma.bed.updateMany({ where: { id: { in: ids.slice(i, i + 400) } }, data: { status: st } });
    }
  }
  console.log(`  已排宿 ${occupancyRows.length} 人（夫妻/家属 ${couplesPlaced} 户，离职未退宿脏数据 ${dirty} 条）`);

  // 少量床位报修
  const freeBedIds = (await prisma.bed.findMany({ where: { status: 'FREE' }, select: { id: true } })).map((b) => b.id);
  const brokenIds = freeBedIds.filter(() => chance(0.015));
  if (brokenIds.length) {
    await prisma.bed.updateMany({ where: { id: { in: brokenIds } }, data: { status: 'MAINTENANCE', note: '床架损坏待修' } });
  }

  // 入住流水
  const recentOcc = await prisma.occupancy.findMany({ take: 300, orderBy: { id: 'desc' } });
  await createManyChunked(prisma.occupancyEvent, recentOcc.map((o) => ({
    type: 'CHECKIN', personId: o.personId, bedId: o.bedId,
    operator: 'seed', createdAt: o.checkInAt, note: '初始化导入',
  })));

  // ============================== 物品 / 押金 ==============================
  console.log('生成物品发放与押金…');
  const liveOccs = await prisma.occupancy.findMany({
    where: { status: { in: ['ACTIVE', 'HELD'] } },
    select: { id: true, personId: true, bedId: true, checkInAt: true },
  });
  const coreItems = itemTypes.filter((i) => ['MATTRESS', 'QUILT', 'PILLOW', 'SHEET', 'ACCESS_CARD', 'LOCKER_KEY'].includes(i.code));
  const issuedRows: any[] = [];
  for (const o of liveOccs) {
    for (const it of coreItems) {
      issuedRows.push({
        personId: o.personId, occupancyId: o.id, bedId: o.bedId, itemTypeId: it.id,
        quantity: 1, issuedAt: o.checkInAt, issuedBy: 'seed',
      });
    }
    if (chance(0.25)) {
      const kettle = itemTypes.find((i) => i.code === 'KETTLE')!;
      issuedRows.push({ personId: o.personId, occupancyId: o.id, bedId: o.bedId, itemTypeId: kettle.id, quantity: 1, issuedAt: o.checkInAt, issuedBy: 'seed' });
    }
  }
  await createManyChunked(prisma.issuedItem, issuedRows);

  const depositRows = liveOccs.map((o) => ({
    personId: o.personId, amount: 150, paidAt: o.checkInAt, note: '入住押金（钥匙 / 门禁卡 / 柜子）',
  }));
  await createManyChunked(prisma.deposit, depositRows);
  console.log(`  物品发放 ${issuedRows.length} 条，押金 ${depositRows.length} 笔`);

  // ============================== 报修工单 ==============================
  console.log('生成报修工单…');
  const residentialRooms = allRoomsFull.filter((r) => r.roomType.isResidential);
  const woRows: any[] = [];
  const woTitles: Record<string, string[]> = {
    PLUMBING: ['卫生间下水堵塞', '水管漏水浸湿墙面', '马桶冲水阀损坏', '洗手池龙头漏水'],
    ELECTRIC: ['房间跳闸无电', '插座烧焦有糊味', '走廊照明不亮', '开关面板松动'],
    AC: ['空调不制冷', '空调滴水', '空调噪音大', '空调遥控器失灵'],
    DOOR: ['房门锁芯卡死', '窗户合页断裂', '门禁刷卡无反应', '纱窗破损蚊虫多'],
    FURNITURE: ['上铺床架焊缝开裂', '柜门脱落', '桌椅腿断裂', '床板断裂'],
    WATER_HEATER: ['热水器不出热水', '热水器漏电跳闸'],
    NETWORK: ['房间无网络信号', '电视无信号'],
    PEST: ['房间有白蚁', '蟑螂较多需消杀', '有老鼠'],
    CLEANING: ['公共卫生间需清洁', '楼道垃圾未清运'],
    OTHER: ['窗帘杆脱落', '晾衣绳断裂'],
  };
  for (let i = 0; i < 180; i++) {
    const cat = pick(woCategories);
    const room = pick(residentialRooms);
    const reportedAt = daysAgo(randInt(0, 90));
    const status = weighted([['NEW', 0.12], ['ASSIGNED', 0.13], ['IN_PROGRESS', 0.15], ['DONE', 0.3], ['CLOSED', 0.27], ['REJECTED', 0.03]] as const);
    const started = ['IN_PROGRESS', 'DONE', 'CLOSED'].includes(status) ? new Date(reportedAt.getTime() + randInt(1, 40) * 3600000) : null;
    const finished = ['DONE', 'CLOSED'].includes(status) ? new Date((started ?? reportedAt).getTime() + randInt(1, 60) * 3600000) : null;
    const blocks = cat.blocksByDefault && chance(0.4);
    woRows.push({
      code: `WO${String(100001 + i).slice(1)}`,
      categoryId: cat.id,
      priority: weighted([['LOW', 0.15], ['NORMAL', 0.5], ['HIGH', 0.25], ['URGENT', 0.1]] as const),
      title: pick(woTitles[cat.code] ?? woTitles.OTHER),
      description: `${room.code} ${pick(woTitles[cat.code] ?? woTitles.OTHER)}，请安排处理。`,
      scopeType: 'ROOM', scopeId: room.id,
      reporterName: '宿管代报', reportedAt,
      assignedTo: status === 'NEW' ? null : pick(['维修一组', '维修二组', '外包电工', '空调班组']),
      status, startedAt: started, finishedAt: finished,
      closedAt: status === 'CLOSED' ? finished : null,
      cost: ['DONE', 'CLOSED'].includes(status) ? randInt(0, 400) : 0,
      blocksOccupancy: blocks,
      rating: status === 'CLOSED' ? randInt(3, 5) : null,
    });
  }
  await createManyChunked(prisma.workOrder, woRows);

  // ============================== 违规记录 ==============================
  console.log('生成违规记录…');
  const housedPersons = await prisma.occupancy.findMany({
    where: { status: { in: ['ACTIVE', 'HELD'] } },
    select: { personId: true, bed: { select: { roomId: true } } },
    take: 2000,
  });
  const vioRows: any[] = [];
  for (let i = 0; i < 130; i++) {
    const t = weighted(violationTypes.map((v) => [v, v.severity === 'CRITICAL' ? 0.6 : v.severity === 'HIGH' ? 1 : 1.6] as const));
    const h = pick(housedPersons);
    const status = weighted([['OPEN', 0.3], ['HANDLED', 0.6], ['APPEALED', 0.07], ['CLOSED', 0.03]] as const);
    vioRows.push({
      code: `VIO${String(10001 + i).slice(1)}`,
      personId: h.personId, roomId: h.bed.roomId, typeId: t.id,
      occurredAt: daysAgo(randInt(0, 180)),
      points: t.defaultPoints, fine: t.defaultFine,
      description: `${t.nameZh}（查寝 / 巡查发现）`,
      recordedBy: pick(['楼栋宿管', '安全环保部', '保安部']),
      action: t.severity === 'CRITICAL' ? 'FINE' : t.severity === 'HIGH' ? 'FINE' : 'WARNING',
      status,
      handledAt: status === 'HANDLED' ? daysAgo(randInt(0, 60)) : null,
    });
  }
  await createManyChunked(prisma.violation, vioRows);


  // ============================== 投诉 ==============================
  console.log('生成投诉记录…');
  const complaintTypes = await prisma.complaintType.findMany();
  const ctByCode: Record<string, any> = Object.fromEntries(complaintTypes.map((t) => [t.code, t]));

  // 投诉人必须是有住宿的人 —— 没住宿的人投诉隔壁没有意义
  const complainantPool = await prisma.occupancy.findMany({
    where: { status: { in: ['ACTIVE', 'HELD'] } },
    select: {
      personId: true,
      bed: { select: { roomId: true, room: { select: { floorId: true, code: true } } } },
    },
    take: 2000,
  });
  const floorRoomMap = new Map<number, { id: number; code: string }[]>();
  for (const r of await prisma.room.findMany({ select: { id: true, code: true, floorId: true } })) {
    if (!floorRoomMap.has(r.floorId)) floorRoomMap.set(r.floorId, []);
    floorRoomMap.get(r.floorId)!.push({ id: r.id, code: r.code });
  }

  const CP_DESC: Record<string, string[]> = {
    NOISE: [
      '隔壁房间凌晨两点还在大声说话唱歌，整层楼都听得到，第二天还要上早班',
      '楼上半夜搬桌子、跺脚，连着好几天了',
      '走廊里有人打电话开免提，声音很大，一直到一两点',
    ],
    HYGIENE: [
      '过道里堆了很多纸箱和垃圾袋，味道很大，推车都过不去',
      '公共卫生间地漏堵了，水漫到走廊上',
      '洗衣房洗衣机里的衣服放了好几天没人拿，别人没法用',
    ],
    ALCOHOL: [
      '隔壁一群人喝酒到很晚，瓶子摔在地上，还在走廊上吵架',
      '周末晚上聚在房间里喝酒划拳，声音很大',
    ],
    SAFETY: [
      '看到隔壁房间从走廊接了个插排进去充电动车电池',
      '有人在房间里用电磁炉煮东西，闻到糊味了',
    ],
    SMOKING: ['楼梯间一直有人抽烟，烟味飘进房间', '有人在房间里抽烟，隔壁都是味道'],
    GUEST: ['隔壁这几天多了两个不认识的人住着，晚上很吵'],
    FACILITY: ['活动室的椅子被搬走了好几把', '公共热水器坏了没人报修，一直没热水'],
    THEFT: ['放在阳台上的鞋子不见了', '柜子里的现金少了，锁没有坏的痕迹'],
    CONFLICT: ['隔壁两个人吵架动手了，把门都踢坏了'],
    DISCRIMINATION: ['同层有人反复用难听的话骂我们，因为国籍不一样'],
    SERVICE: [
      '报修了一个星期没人来，问宿管也不回',
      '换床位的时候感觉不太公平，想反映一下',
    ],
    OTHER: ['其他情况，想反映一下'],
  };
  const CP_DESC_ID: Record<string, string[]> = {
    NOISE: [
      'Kamar sebelah masih ribut nyanyi jam 2 pagi, besok saya shift pagi',
      'Lantai atas geser meja dan hentak kaki tengah malam, sudah beberapa hari',
    ],
    HYGIENE: [
      'Koridor penuh kardus dan sampah, baunya menyengat',
      'Saluran kamar mandi umum tersumbat, air sampai ke koridor',
    ],
    ALCOHOL: ['Sebelah minum-minum sampai larut, botol pecah di lantai'],
    SAFETY: ['Ada yang menarik kabel dari koridor untuk mengisi baterai motor listrik'],
    SMOKING: ['Ada yang merokok di tangga, asapnya masuk kamar'],
    GUEST: ['Beberapa hari ini ada orang asing menginap di kamar sebelah'],
    FACILITY: ['Kursi ruang serbaguna hilang beberapa'],
    THEFT: ['Sepatu di balkon hilang'],
    CONFLICT: ['Dua orang di sebelah berkelahi sampai pintu rusak'],
    DISCRIMINATION: ['Ada yang berulang kali menghina kami karena beda kewarganegaraan'],
    SERVICE: ['Sudah lapor perbaikan seminggu belum ada yang datang'],
    OTHER: ['Ingin melaporkan hal lain'],
  };

  const cpWeights = complaintTypes.map(
    (t) => [t, t.code === 'NOISE' ? 3.2 : t.code === 'HYGIENE' ? 2.4 : t.code === 'ALCOHOL' ? 1.6 :
                t.code === 'SMOKING' ? 1.2 : t.code === 'SAFETY' ? 0.9 : t.code === 'SERVICE' ? 0.8 :
                t.code === 'FACILITY' ? 0.8 : t.code === 'GUEST' ? 0.6 : 0.4] as const
  );

  const complaintRows: any[] = [];
  const eventRows: { complaintId: number; type: string; operator: string; note: string; visibleToComplainant: boolean; createdAt: Date }[] = [];

  /** 一条投诉的完整构造。状态越靠后，处理流水越长 */
  const makeComplaint = (i: number, forcedType?: any, forcedRoomId?: number, forcedPersonId?: number) => {
    const t = forcedType ?? weighted(cpWeights);
    const src = complainantPool[forcedPersonId
      ? complainantPool.findIndex((c) => c.personId === forcedPersonId)
      : Math.floor(rnd() * complainantPool.length)] ?? pick(complainantPool);

    // 投诉对象：同层的另一个房间（现实里绝大多数投诉是隔壁）
    const sameFloor = (floorRoomMap.get(src.bed.room.floorId) ?? []).filter((r) => r.id !== src.bed.roomId);
    const isPublicArea = ['HYGIENE', 'FACILITY'].includes(t.code) && chance(0.45);
    const targetRoomId = forcedRoomId ?? (isPublicArea ? null : (sameFloor.length > 0 ? pick(sameFloor).id : null));
    if (!targetRoomId && !isPublicArea) return null;

    // 发生时段：噪音类集中在深夜，其它类白天居多。
    // 这正是「发生时段」要单独存的原因 —— 提交时间基本都在白天
    const daysBack = randInt(0, 45);
    const occurred = daysAgo(daysBack);
    if (['NOISE', 'ALCOHOL'].includes(t.code)) occurred.setHours(randInt(23, 26) % 24, randInt(0, 59), 0, 0);
    else occurred.setHours(randInt(8, 21), randInt(0, 59), 0, 0);
    // 提交时间在发生之后，噪音类往往是第二天早上才来投诉
    const submitted = new Date(occurred.getTime() + (['NOISE', 'ALCOHOL'].includes(t.code)
      ? randInt(5, 14) * 3600000
      : randInt(1, 6) * 3600000));
    if (submitted.getTime() > Date.now()) submitted.setTime(Date.now() - 3600000);

    const status = weighted([
      ['NEW', 0.16], ['ACCEPTED', 0.12], ['INVESTIGATING', 0.12],
      ['SUBSTANTIATED', 0.34], ['UNSUBSTANTIATED', 0.16], ['CLOSED', 0.07], ['WITHDRAWN', 0.03],
    ] as const);

    const isCN = chance(0.55);
    const descPool = (isCN ? CP_DESC : CP_DESC_ID)[t.code] ?? CP_DESC[t.code] ?? CP_DESC.OTHER;

    return {
      code: `CP${String(10001 + i).slice(1)}`,
      typeId: t.id,
      complainantId: src.personId,
      // 匿名占比刻意做得高 —— 这就是半匿名设计要解决的问题：
      // 强制实名的话这些人根本不会来投诉
      anonymous: t.allowAnonymous && chance(0.62),
      targetRoomId,
      targetFloorId: targetRoomId ? null : src.bed.room.floorId,
      targetArea: targetRoomId ? null : pick(['走廊', '公共卫生间', '洗衣房', '楼梯间', '活动室']),
      occurredFrom: occurred,
      occurredTo: ['NOISE', 'ALCOHOL'].includes(t.code)
        ? new Date(occurred.getTime() + randInt(1, 3) * 3600000) : null,
      description: pick(descPool),
      lang: isCN ? 'zh' : 'id',
      status,
      priority: t.severity === 'CRITICAL' ? 'URGENT' : t.severity === 'HIGH' ? 'HIGH' : 'NORMAL',
      submittedAt: submitted,
      acceptedAt: status === 'NEW' ? null : new Date(submitted.getTime() + randInt(1, 10) * 3600000),
      resolvedAt: ['SUBSTANTIATED', 'UNSUBSTANTIATED', 'CLOSED', 'WITHDRAWN'].includes(status)
        ? new Date(submitted.getTime() + randInt(12, 72) * 3600000) : null,
      closedAt: status === 'CLOSED' ? new Date(submitted.getTime() + randInt(72, 120) * 3600000) : null,
      handledBy: status === 'NEW' ? null : pick(['楼栋宿管', '宿舍主管', '安全环保部']),
      resolution:
        status === 'SUBSTANTIATED' ? '现场核实属实，已对涉事房间当面提醒并记录违规，会持续回访。'
        : status === 'UNSUBSTANTIATED' ? '当晚查寝到现场核实，未发现所述情况；也询问了同层其他房间，暂无法证实。如再次发生请随时反映。'
        : status === 'CLOSED' ? '已处理完毕并归档。'
        : null,
      rating: ['SUBSTANTIATED', 'UNSUBSTANTIATED', 'CLOSED'].includes(status) && chance(0.55)
        ? (status === 'SUBSTANTIATED' ? randInt(4, 5) : randInt(2, 5)) : null,
    };
  };

  for (let i = 0; i < 64; i++) {
    const row = makeComplaint(i);
    if (row) complaintRows.push(row);
  }

  // 刻意造两组「多人反映同一件事」—— 演示聚合与优先级升级
  const hotSource = complainantPool.filter((c) => (floorRoomMap.get(c.bed.room.floorId) ?? []).length > 4);
  for (const [gi, code] of [[0, 'NOISE'], [1, 'ALCOHOL']] as const) {
    const seedPerson = hotSource[gi * 37 % hotSource.length];
    if (!seedPerson) continue;
    const neighbours = (floorRoomMap.get(seedPerson.bed.room.floorId) ?? []).filter((r) => r.id !== seedPerson.bed.roomId);
    if (neighbours.length < 4) continue;
    const target = neighbours[0].id;
    // 同层四个不同房间的人，在同一个晚上分别反映同一间房
    const reporters = complainantPool
      .filter((c) => c.bed.room.floorId === seedPerson.bed.room.floorId && c.bed.roomId !== target)
      .slice(0, 4);
    reporters.forEach((rp, k) => {
      const row = makeComplaint(200 + gi * 10 + k, ctByCode[code], target, rp.personId);
      if (row) {
        row.complainantId = rp.personId;
        row.status = k === 0 ? 'SUBSTANTIATED' : 'ACCEPTED';
        row.priority = 'HIGH';
        complaintRows.push(row);
      }
    });
  }

  // 再造一条「投诉宿管本人」的 —— 演示它不会出现在楼栋宿管的列表里
  {
    const rp = pick(complainantPool);
    const row = makeComplaint(900, ctByCode.SERVICE, undefined, rp.personId);
    if (row) {
      row.targetRoomId = null;
      row.targetFloorId = rp.bed.room.floorId;
      row.targetArea = '宿管室';
      row.anonymous = true;
      row.status = 'ACCEPTED';
      row.description = '报修交上去一个多星期没人来看，去问宿管也不理人，想请上级帮忙看一下。';
      row.lang = 'zh';
      complaintRows.push(row);
    }
  }

  await createManyChunked(prisma.complaint, complaintRows);

  // 处理流水：每条至少有提交，处理过的补上后续
  const savedComplaints = await prisma.complaint.findMany({
    select: { id: true, status: true, submittedAt: true, acceptedAt: true, resolvedAt: true, closedAt: true, handledBy: true, anonymous: true, resolution: true },
  });
  for (const c of savedComplaints) {
    eventRows.push({
      complaintId: c.id, type: 'SUBMIT',
      operator: c.anonymous ? '匿名投诉人' : '投诉人',
      note: '投诉已提交', visibleToComplainant: true, createdAt: c.submittedAt,
    });
    if (c.acceptedAt) {
      eventRows.push({
        complaintId: c.id, type: 'ACCEPT', operator: c.handledBy ?? '楼栋宿管',
        note: '已受理，正在安排核实', visibleToComplainant: true, createdAt: c.acceptedAt,
      });
      eventRows.push({
        complaintId: c.id, type: 'INVESTIGATE', operator: c.handledBy ?? '楼栋宿管',
        // 内部核实过程对投诉人不可见
        note: pick(['当晚 23:30 到现场查看', '已询问同层其他房间', '已调取该层走廊监控时间段', '已当面询问涉事房间人员']),
        visibleToComplainant: false,
        createdAt: new Date(c.acceptedAt.getTime() + randInt(1, 12) * 3600000),
      });
    }
    if (c.resolvedAt && c.resolution) {
      eventRows.push({
        complaintId: c.id, type: 'RESOLVE', operator: c.handledBy ?? '宿舍主管',
        note: `${c.status === 'SUBSTANTIATED' ? '认定成立' : c.status === 'UNSUBSTANTIATED' ? '认定不成立' : '已处理'}：${c.resolution}`,
        visibleToComplainant: true, createdAt: c.resolvedAt,
      });
    }
    if (c.closedAt) {
      eventRows.push({
        complaintId: c.id, type: 'CLOSE', operator: c.handledBy ?? '宿舍主管',
        note: '已归档', visibleToComplainant: true, createdAt: c.closedAt,
      });
    }
  }
  await createManyChunked(prisma.complaintEvent, eventRows);

  // ============================== 访客 ==============================
  console.log('生成访客登记…');
  const hostPool = await prisma.person.findMany({ where: { personType: 'EMPLOYEE', employmentStatus: 'ACTIVE' }, take: 500 });
  const visRows: any[] = [];
  for (let i = 0; i < 45; i++) {
    const host = pick(hostPool);
    const overnight = chance(0.35);
    const status = weighted([['PENDING', 0.15], ['APPROVED', 0.2], ['IN', 0.2], ['OUT', 0.4], ['REJECTED', 0.05]] as const);
    visRows.push({
      code: `V${String(10001 + i).slice(1)}`,
      name: makeName(host.nationalityId, chance(0.5) ? 'MALE' : 'FEMALE'),
      idNumber: `${host.nationalityId[0]}${randInt(10000000, 99999999)}`,
      phone: `+62 8${randInt(10, 99)}-${randInt(1000, 9999)}-${randInt(1000, 9999)}`,
      nationalityId: host.nationalityId,
      hostPersonId: host.id,
      purpose: pick(['探亲', '业务洽谈', '设备厂家调试', '同乡探访', '家属探望']),
      checkInAt: daysAgo(randInt(0, 60)),
      expectedOutAt: daysAhead(randInt(0, 3)),
      checkOutAt: status === 'OUT' ? daysAgo(randInt(0, 30)) : null,
      overnight, status,
      approvedBy: ['APPROVED', 'IN', 'OUT'].includes(status) ? '宿舍主管' : null,
      registeredBy: '门岗',
      note: overnight ? '留宿需审批' : null,
    });
  }
  await createManyChunked(prisma.visitor, visRows);

  // ============================== 查寝 / 检查 ==============================
  console.log('生成查寝与卫生检查…');
  const floorsAll = await prisma.floor.findMany({ include: { building: true, rooms: { include: { beds: { include: { occupancies: { where: { status: 'ACTIVE' } } } } } } } });
  const inspRows: any[] = [];
  for (let i = 0; i < 24; i++) {
    const f = pick(floorsAll);
    const type = weighted([['NIGHT_ROLL_CALL', 0.5], ['HYGIENE', 0.35], ['SAFETY', 0.15]] as const);
    const planned = daysAgo(randInt(0, 45));
    const done = chance(0.8);
    inspRows.push({
      code: `INS${String(10001 + i).slice(1)}`,
      type, scopeType: 'FLOOR', scopeId: f.id,
      plannedAt: planned,
      executedAt: done ? planned : null,
      inspector: pick(['楼栋宿管', '宿舍主管', '安全环保部']),
      status: done ? 'DONE' : 'PLANNED',
      score: done && type !== 'NIGHT_ROLL_CALL' ? randInt(70, 99) : null,
      summary: done ? (type === 'NIGHT_ROLL_CALL' ? '夜间点名完成' : '检查完成，个别房间需整改') : null,
      _floorId: f.id,
    });
  }
  await createManyChunked(prisma.inspection, inspRows.map(({ _floorId, ...r }) => r));
  const inspections = await prisma.inspection.findMany({ orderBy: { id: 'asc' } });
  const inspItemRows: any[] = [];
  inspections.forEach((ins, idx) => {
    if (ins.status !== 'DONE') return;
    const f = floorsAll.find((x) => x.id === ins.scopeId)!;
    for (const room of f.rooms.slice(0, 8)) {
      if (ins.type === 'NIGHT_ROLL_CALL') {
        for (const bed of room.beds) {
          const occ = bed.occupancies[0];
          if (!occ) continue;
          inspItemRows.push({
            inspectionId: ins.id, roomId: room.id, personId: occ.personId,
            present: chance(0.93), createdAt: ins.executedAt!,
          });
        }
      } else {
        inspItemRows.push({
          inspectionId: ins.id, roomId: room.id,
          score: randInt(60, 100),
          issues: chance(0.3) ? pick(['地面积水', '垃圾未清', '阳台堆放杂物', '插线板超载', '窗台落灰']) : null,
          createdAt: ins.executedAt!,
        });
      }
    }
  });
  await createManyChunked(prisma.inspectionItem, inspItemRows);

  // ============================== 申请 / 公告 / 用户 ==============================
  console.log('生成申请、公告与账号…');
  const reqRows: any[] = [];
  const reqPool = await prisma.person.findMany({ where: { employmentStatus: 'ACTIVE' }, take: 400 });
  for (let i = 0; i < 26; i++) {
    const p = pick(reqPool);
    const type = weighted([['TRANSFER', 0.4], ['COUPLE_ROOM', 0.2], ['CHECKOUT', 0.15], ['VISITOR_OVERNIGHT', 0.15], ['EXTRA_BED', 0.1]] as const);
    const status = weighted([['PENDING', 0.5], ['APPROVED', 0.3], ['REJECTED', 0.12], ['DONE', 0.08]] as const);
    reqRows.push({
      code: `REQ${String(10001 + i).slice(1)}`,
      type, personId: p.id,
      reason: {
        TRANSFER: '与室友作息冲突，申请调换房间',
        COUPLE_ROOM: '配偶已随迁抵园，申请夫妻房',
        CHECKOUT: '合同到期离园，申请退宿',
        VISITOR_OVERNIGHT: '家属探访，申请留宿两晚',
        EXTRA_BED: '新员工临时到岗，申请加床',
      }[type],
      status,
      submittedBy: p.name,
      submittedAt: daysAgo(randInt(0, 30)),
      approvedBy: status === 'PENDING' ? null : '宿舍主管',
      approvedAt: status === 'PENDING' ? null : daysAgo(randInt(0, 10)),
    });
  }
  await createManyChunked(prisma.request, reqRows);

  await prisma.announcement.createMany({
    data: [
      { title: 'A、B 栋本周六停水检修', content: '本周六 09:00-15:00 A、B 栋停水进行管道检修，请提前储水。',
        titleId: 'Air mati Sabtu ini di Gedung A & B', contentId: 'Sabtu 09:00-15:00 air dimatikan untuk perbaikan pipa.',
        titleEn: 'Water shutdown Saturday, Blocks A & B', contentEn: 'Water off 09:00-15:00 this Saturday for pipe maintenance.',
        level: 'WARNING', scopeType: 'ALL', publishedBy: '宿舍主管', publishedAt: daysAgo(2), expiresAt: daysAhead(5) },
      { title: '严禁在宿舍内使用大功率电器', content: '近期查获多起使用电磁炉、热得快案例，一经发现按违规处理并罚款。',
        titleId: 'Dilarang menggunakan alat listrik daya tinggi', contentId: 'Pelanggaran akan dikenakan sanksi dan denda.',
        titleEn: 'High-power appliances strictly prohibited', contentEn: 'Violations will be fined.',
        level: 'URGENT', scopeType: 'ALL', publishedBy: '安全环保部', publishedAt: daysAgo(6) },
      { title: '消防疏散演练通知', content: '下周三 15:00 全园区消防疏散演练，请各楼栋住户配合。',
        titleId: 'Latihan evakuasi kebakaran', contentId: 'Rabu depan 15:00, mohon kerja sama seluruh penghuni.',
        titleEn: 'Fire evacuation drill', contentEn: 'Next Wednesday 15:00, all residents please cooperate.',
        level: 'INFO', scopeType: 'ALL', publishedBy: '安全环保部', publishedAt: daysAgo(1), expiresAt: daysAhead(9) },
      { title: 'H 栋夫妻房申请开放', content: '本月夫妻房余量 12 间，符合条件的员工可提交申请，需提供结婚证复印件。',
        titleId: 'Pendaftaran kamar suami istri Gedung H', contentId: 'Tersedia 12 kamar bulan ini, lampirkan surat nikah.',
        titleEn: 'Couple rooms open for application (Block H)', contentEn: '12 rooms available; marriage certificate required.',
        level: 'INFO', scopeType: 'BUILDING', scopeId: buildingIds['H'], publishedBy: '宿舍管理科', publishedAt: daysAgo(4) },
      { title: '斋月期间食堂与作息调整', content: '斋月期间夜间加餐时段调整，祷告室开放至凌晨，请相互体谅。',
        titleId: 'Penyesuaian jadwal selama Ramadan', contentId: 'Jam makan malam disesuaikan, mushola buka sampai dini hari.',
        titleEn: 'Ramadan schedule adjustments', contentEn: 'Night meal times adjusted; prayer room open late.',
        level: 'INFO', scopeType: 'ALL', publishedBy: '行政后勤部', publishedAt: daysAgo(10) },
    ],
  });

  const wardenRole = roles.find((r) => r.code === 'WARDEN')!;
  const users = [
    { username: 'admin', name: '系统管理员', roleId: roles.find((r) => r.code === 'ADMIN')!.id },
    { username: 'dorm.chief', name: '宿舍主管 · 张明', roleId: roles.find((r) => r.code === 'DORM_MANAGER')!.id },
    { username: 'hr01', name: '人力资源 · 李静', roleId: roles.find((r) => r.code === 'HR')!.id },
    { username: 'ehs01', name: '安全环保 · Budi', roleId: roles.find((r) => r.code === 'EHS')!.id },
  ];
  for (const cfg of BUILDINGS) {
    users.push({ username: `warden.${cfg.code.toLowerCase()}`, name: `${cfg.code}栋宿管`, roleId: wardenRole.id });
  }
  await prisma.user.createMany({ data: users });
  const createdUsers = await prisma.user.findMany();
  const scopeRows: any[] = [];
  for (const cfg of BUILDINGS) {
    const u = createdUsers.find((x) => x.username === `warden.${cfg.code.toLowerCase()}`)!;
    scopeRows.push({ userId: u.id, buildingId: buildingIds[cfg.code] });
  }
  await prisma.userBuilding.createMany({ data: scopeRows });

  // ============================== 设备 ==============================
  console.log('登记设备占位（门禁 / 电表 / 摄像头预留）…');
  const floors = await prisma.floor.findMany({ include: { building: true } });
  const deviceRows: any[] = [];
  for (const f of floors) {
    deviceRows.push({
      type: 'DOOR', name: `${f.building.code}栋 ${f.level}层 门禁`,
      scopeType: 'FLOOR', scopeId: f.id, vendor: 'HIKVISION',
      ipAddress: `10.20.${f.building.sortOrder + 1}.${100 + f.level}`, isActive: true,
    });
    deviceRows.push({
      type: 'CAMERA', name: `${f.building.code}栋 ${f.level}层 楼道摄像头`,
      scopeType: 'FLOOR', scopeId: f.id, vendor: 'HIKVISION',
      ipAddress: `10.30.${f.building.sortOrder + 1}.${100 + f.level}`, channel: '1',
      isActive: false, note: '点位已登记，二期接入视频网关后启用',
    });
  }
  for (const b of await prisma.building.findMany()) {
    deviceRows.push({
      type: 'METER', name: `${b.code}栋 总电表`, scopeType: 'BUILDING', scopeId: b.id,
      vendor: 'ACREL', ipAddress: `10.40.${b.sortOrder + 1}.10`, isActive: true,
      note: '楼栋总表，房间无分表，按在住人天分摊',
    });
  }
  await createManyChunked(prisma.device, deviceRows);

  // ============================== 平台层（账号 / 集成 / 通知） ==============================
  await seedPlatform(prisma, buildingIds);

  // ============================== 汇总 ==============================
  const [bedTotal, bedUsable, occCount, personCount, deratedCount, funcRoomCount] = await Promise.all([
    prisma.bed.count(),
    prisma.bed.count({ where: { status: { notIn: ['DISABLED'] } } }),
    prisma.occupancy.count({ where: { status: { in: ['ACTIVE', 'HELD'] } } }),
    prisma.person.count(),
    prisma.room.count({ where: { deratedReason: { not: null } } }),
    prisma.room.count({ where: { roomType: { isResidential: false } } }),
  ]);
  console.log('\n完成：');
  console.log(`  房间 ${roomRows.length}（功能房 ${funcRoomCount}，降标房间 ${deratedCount}）`);
  console.log(`  床位 ${bedTotal}（可用 ${bedUsable}，撤除 ${bedTotal - bedUsable}）`);
  console.log(`  人员 ${personCount}，在住/保留 ${occCount}，入住率 ${((occCount / bedUsable) * 100).toFixed(1)}%`);
  console.log(`  工单 ${woRows.length}，违规 ${vioRows.length}，访客 ${visRows.length}，检查 ${inspRows.length}，申请 ${reqRows.length}`);
}
