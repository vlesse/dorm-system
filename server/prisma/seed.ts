/**
 * 模拟数据生成器
 *
 * 一期没有真实花名册，这里按青山园区的实际形态生成一套可信的假数据：
 *   8 栋楼、层数不等（4 / 6 / 8 层）、国籍分区做到楼层级、
 *   干部房与酒店式客房单列、按职级配不同休假周期。
 *
 * 数据规模、比例、楼栋配置都在本文件顶部的常量里，随时可调。
 * 重新生成：npm run db:seed -w server（会先清空业务数据）
 */
import { PrismaClient } from '@prisma/client';
import { evaluateAssignment, splitChecks, DEFAULT_RULES, type PersonLike } from '../src/services/rules.js';

const prisma = new PrismaClient();

// ---------------------------------------------------------------- 可调参数
const TOTAL_PEOPLE = 2500; // 生成多少人
const TARGET_OCCUPANCY = 0.87; // 目标入住率
const RESIGNED_STILL_HOLDING_BED = 18; // 故意制造的「离职未退宿」脏数据，用来演示告警
const RNG_SEED = 20260902;

/** 可复现的伪随机数，保证每次生成的数据一样，方便演示 */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(RNG_SEED);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const randInt = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
/** 按权重抽样：weights 形如 [['A',0.6],['B',0.4]] */
function weighted<T>(weights: readonly (readonly [T, number])[]): T {
  const total = weights.reduce((s, w) => s + w[1], 0);
  let r = rnd() * total;
  for (const [v, w] of weights) {
    r -= w;
    if (r <= 0) return v;
  }
  return weights[weights.length - 1][0];
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

// ---------------------------------------------------------------- 姓名池
const CN_SURNAME = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严武戴莫孔向汤'.split('');
const CN_GIVEN_M = ['伟','强','磊','军','洋','勇','杰','涛','明','超','刚','建国','志强','建华','文华','建军','国强','海涛','宇航','浩然','天佑','俊杰','晓东','立新','振华','永强','小龙','世豪','鹏飞','金龙','德山','忠诚','兴旺','大勇','广良','传军','庆华','守义','运来','长江'];
const CN_GIVEN_F = ['芳','娜','秀英','敏','静','丽','艳','娟','霞','平','桂英','小红','雪梅','丹丹','晓燕','玉兰','秀兰','海燕','春燕','文静'];
const ID_GIVEN_M = ['Budi','Agus','Joko','Andi','Bambang','Dedi','Eko','Hendra','Rudi','Slamet','Wahyu','Yusuf','Ahmad','Muhammad','Iwan','Fajar','Rizki','Dwi','Tri','Adi','Anwar','Bayu','Candra','Dani','Firman','Gunawan','Hadi','Imam','Jaya','Krisna','Lukman','Nanda','Oki','Putra','Rahmat','Surya','Taufik','Umar','Vino','Yanto'];
const ID_GIVEN_F = ['Siti','Dewi','Sri','Rina','Ayu','Indah','Lestari','Nurul','Wati','Yuni','Fitri','Ratna','Maya','Putri','Anisa','Melati','Kartika','Wulan'];
const ID_SURNAME = ['Santoso','Wijaya','Saputra','Pratama','Nugroho','Setiawan','Hidayat','Kurniawan','Susanto','Permana','Ramadhan','Maulana','Firdaus','Sari','Anggraini','Halim','Tanjung','Simatupang','Manurung','Pangestu'];
const KR_NAME = ['Kim Min-jun','Lee Ji-ho','Park Seo-jun','Choi Woo-jin','Jung Ha-eun','Kang Dae-hyun','Yoon Seok-ho','Lim Jae-min'];
const DE_NAME = ['Lukas Müller','Jonas Schmidt','Felix Weber','Klaus Fischer','Markus Wagner','Stefan Becker'];
const VN_NAME = ['Nguyen Van Hung','Tran Minh Tuan','Le Thi Lan','Pham Quoc Anh','Hoang Van Nam','Vu Duc Manh'];

// ---------------------------------------------------------------- 楼栋配置
type RoomMix = Record<string, number>;
interface BuildingCfg {
  code: string;
  name: string;
  gender: 'MALE' | 'FEMALE' | 'MIXED';
  nationality: string | null;
  floors: number;
  roomsPerFloor: number;
  /** 楼层国籍归属覆盖，支持「1、2 楼印尼籍，3 楼中方」 */
  floorNationality?: Record<number, string | null>;
  mix: RoomMix;
  note?: string;
}

const BUILDINGS: BuildingCfg[] = [
  { code: 'A', name: 'A栋 中方员工宿舍', gender: 'MALE', nationality: 'CN', floors: 8, roomsPerFloor: 14, mix: { STD6: 0.8, STD4: 0.2 } },
  { code: 'B', name: 'B栋 中方员工宿舍', gender: 'MALE', nationality: 'CN', floors: 6, roomsPerFloor: 14, mix: { STD6: 0.7, STD4: 0.3 } },
  { code: 'C', name: 'C栋 印尼籍员工宿舍', gender: 'MALE', nationality: 'ID', floors: 6, roomsPerFloor: 16, mix: { STD8: 0.5, STD6: 0.5 } },
  { code: 'D', name: 'D栋 印尼籍员工宿舍', gender: 'MALE', nationality: 'ID', floors: 4, roomsPerFloor: 16, mix: { STD8: 0.6, STD6: 0.4 } },
  {
    code: 'E', name: 'E栋 混合宿舍', gender: 'MALE', nationality: null, floors: 6, roomsPerFloor: 12,
    floorNationality: { 1: 'ID', 2: 'ID', 3: 'CN', 4: 'CN', 5: null, 6: null },
    mix: { STD6: 0.6, ENG2: 0.4 },
    note: '一、二层印尼籍，三、四层中方，五、六层不限国籍（含外籍）',
  },
  {
    code: 'F', name: 'F栋 女员工宿舍', gender: 'FEMALE', nationality: null, floors: 4, roomsPerFloor: 12,
    floorNationality: { 1: 'ID', 2: 'ID', 3: 'CN', 4: null },
    mix: { STD4: 0.7, ENG2: 0.3 },
  },
  { code: 'G', name: 'G栋 干部楼 / 专家公寓', gender: 'MIXED', nationality: null, floors: 4, roomsPerFloor: 10, mix: { CADRE1: 0.5, EXPERT: 0.3, ENG2: 0.2 }, note: '中层及以上专用' },
  { code: 'H', name: 'H栋 酒店式公寓', gender: 'MIXED', nationality: null, floors: 8, roomsPerFloor: 12, mix: { HOTEL: 0.85, QUAR: 0.15 }, note: '按酒店模式管理，含隔离房' },
];

const BED_LAYOUT: Record<number, Array<{ label: string; position: string }>> = {
  1: [{ label: '1', position: 'SINGLE' }],
  2: [{ label: '1', position: 'SINGLE' }, { label: '2', position: 'SINGLE' }],
  4: [
    { label: '1 下铺', position: 'LOWER' }, { label: '1 上铺', position: 'UPPER' },
    { label: '2 下铺', position: 'LOWER' }, { label: '2 上铺', position: 'UPPER' },
  ],
  6: [
    { label: '1 下铺', position: 'LOWER' }, { label: '1 上铺', position: 'UPPER' },
    { label: '2 下铺', position: 'LOWER' }, { label: '2 上铺', position: 'UPPER' },
    { label: '3 下铺', position: 'LOWER' }, { label: '3 上铺', position: 'UPPER' },
  ],
  8: [
    { label: '1 下铺', position: 'LOWER' }, { label: '1 上铺', position: 'UPPER' },
    { label: '2 下铺', position: 'LOWER' }, { label: '2 上铺', position: 'UPPER' },
    { label: '3 下铺', position: 'LOWER' }, { label: '3 上铺', position: 'UPPER' },
    { label: '4 下铺', position: 'LOWER' }, { label: '4 上铺', position: 'UPPER' },
  ],
};

// ================================================================ main
async function main() {
  console.log('清空旧数据…');
  await prisma.occupancyEvent.deleteMany();
  await prisma.occupancy.deleteMany();
  await prisma.person.deleteMany();
  await prisma.bed.deleteMany();
  await prisma.room.deleteMany();
  await prisma.floor.deleteMany();
  await prisma.building.deleteMany();
  await prisma.site.deleteMany();
  await prisma.device.deleteMany();
  await prisma.roomType.deleteMany();
  await prisma.contractor.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.positionLevel.deleteMany();
  await prisma.department.deleteMany();
  await prisma.nationality.deleteMany();
  await prisma.settingItem.deleteMany();

  // -------------------------------------------------- 字典
  console.log('写入配置字典…');
  await prisma.nationality.createMany({
    data: [
      { id: 'ID', nameZh: '印度尼西亚', nameEn: 'Indonesia', nameId: 'Indonesia', color: '#f5222d', sortOrder: 1 },
      { id: 'CN', nameZh: '中国', nameEn: 'China', nameId: 'Tiongkok', color: '#fa8c16', sortOrder: 2 },
      { id: 'KR', nameZh: '韩国', nameEn: 'South Korea', nameId: 'Korea Selatan', color: '#722ed1', sortOrder: 3 },
      { id: 'DE', nameZh: '德国', nameEn: 'Germany', nameId: 'Jerman', color: '#13c2c2', sortOrder: 4 },
      { id: 'VN', nameZh: '越南', nameEn: 'Vietnam', nameId: 'Vietnam', color: '#52c41a', sortOrder: 5 },
    ],
  });

  const deptData = [
    ['SMELT', '镍铁冶炼厂', 'Ferronickel Smelter', 'Pabrik Peleburan Feronikel'],
    ['STEEL', '不锈钢炼钢厂', 'Stainless Steel Plant', 'Pabrik Baja Nirkarat'],
    ['POWER', '电厂', 'Power Plant', 'Pembangkit Listrik'],
    ['COKE', '焦化厂', 'Coking Plant', 'Pabrik Kokas'],
    ['PORT', '港务部', 'Port Operations', 'Operasi Pelabuhan'],
    ['EQUIP', '设备动力部', 'Equipment & Utilities', 'Peralatan & Utilitas'],
    ['EHS', '安全环保部', 'Safety & Environment', 'K3 & Lingkungan'],
    ['HR', '人力资源部', 'Human Resources', 'Sumber Daya Manusia'],
    ['ADMIN', '行政后勤部', 'Administration', 'Administrasi'],
    ['PROC', '采购部', 'Procurement', 'Pengadaan'],
    ['FIN', '财务部', 'Finance', 'Keuangan'],
    ['SEC', '保安部', 'Security', 'Keamanan'],
    ['CONST', '工程建设部', 'Construction', 'Konstruksi'],
  ];
  await prisma.department.createMany({
    data: deptData.map(([code, zh, en, id], i) => ({ code, nameZh: zh, nameEn: en, nameId: id, sortOrder: i })),
  });

  // 职级 —— 休假周期就在这里，改这里即可，不用动代码
  await prisma.positionLevel.createMany({
    data: [
      { code: 'WORKER', nameZh: '普通员工', nameEn: 'Worker', nameId: 'Karyawan', rank: 10, leaveCycleMonths: 6, isLeadership: false },
      { code: 'ENGINEER', nameZh: '工程师', nameEn: 'Engineer', nameId: 'Insinyur', rank: 20, leaveCycleMonths: 5.5, isLeadership: false },
      { code: 'SECTION', nameZh: '科长', nameEn: 'Section Chief', nameId: 'Kepala Seksi', rank: 30, leaveCycleMonths: 5.5, isLeadership: false },
      { code: 'DIVISION', nameZh: '部长', nameEn: 'Division Head', nameId: 'Kepala Divisi', rank: 40, leaveCycleMonths: 4.5, isLeadership: true },
      { code: 'MANAGER', nameZh: '经理', nameEn: 'Manager', nameId: 'Manajer', rank: 50, leaveCycleMonths: 4.5, isLeadership: true },
      { code: 'GM', nameZh: '总经理', nameEn: 'General Manager', nameId: 'Manajer Umum', rank: 60, leaveCycleMonths: 3, isLeadership: true },
    ],
  });

  await prisma.shift.createMany({
    data: [
      { code: 'DAY', nameZh: '白班', nameEn: 'Day Shift', nameId: 'Sif Siang', startTime: '08:00', endTime: '20:00', color: '#faad14' },
      { code: 'NIGHT', nameZh: '夜班', nameEn: 'Night Shift', nameId: 'Sif Malam', startTime: '20:00', endTime: '08:00', color: '#2f54eb' },
      { code: 'ADMIN', nameZh: '常日班', nameEn: 'Office Hours', nameId: 'Jam Kantor', startTime: '08:00', endTime: '17:00', color: '#52c41a' },
    ],
  });

  await prisma.contractor.createMany({
    data: [
      { code: 'SELF', name: '本公司自有员工', isSelf: true },
      { code: 'PT-BKS', name: 'PT. Bintang Karya Sulawesi', contact: 'Hendra', phone: '+62 812-3456-7801' },
      { code: 'PT-MJP', name: 'PT. Morowali Jaya Perkasa', contact: 'Agus', phone: '+62 812-3456-7802' },
      { code: 'CN-CONST', name: '中建海外工程分包', contact: '刘工', phone: '+62 812-3456-7803' },
    ],
  });

  await prisma.roomType.createMany({
    data: [
      { code: 'STD8', nameZh: '八人间', nameEn: '8-Bed Room', nameId: 'Kamar 8 Orang', defaultCapacity: 8, dailyRate: 12, color: '#bae0ff', sortOrder: 1 },
      { code: 'STD6', nameZh: '六人间', nameEn: '6-Bed Room', nameId: 'Kamar 6 Orang', defaultCapacity: 6, dailyRate: 15, color: '#91caff', sortOrder: 2 },
      { code: 'STD4', nameZh: '四人间', nameEn: '4-Bed Room', nameId: 'Kamar 4 Orang', defaultCapacity: 4, dailyRate: 20, color: '#69b1ff', sortOrder: 3 },
      { code: 'ENG2', nameZh: '工程师双人间', nameEn: 'Engineer Twin', nameId: 'Kamar Insinyur', defaultCapacity: 2, minPositionRank: 20, dailyRate: 35, color: '#4096ff', sortOrder: 4 },
      { code: 'CADRE1', nameZh: '干部单间', nameEn: 'Supervisor Single', nameId: 'Kamar Pimpinan', defaultCapacity: 1, minPositionRank: 40, dailyRate: 60, color: '#1677ff', sortOrder: 5 },
      { code: 'EXPERT', nameZh: '专家公寓', nameEn: 'Expert Apartment', nameId: 'Apartemen Ahli', defaultCapacity: 1, minPositionRank: 50, dailyRate: 90, color: '#0958d9', sortOrder: 6 },
      { code: 'HOTEL', nameZh: '酒店式客房', nameEn: 'Hotel Room', nameId: 'Kamar Hotel', managementMode: 'HOTEL', defaultCapacity: 2, dailyRate: 120, color: '#9254de', sortOrder: 7 },
      { code: 'QUAR', nameZh: '隔离 / 病号房', nameEn: 'Quarantine Room', nameId: 'Kamar Isolasi', defaultCapacity: 4, dailyRate: 0, color: '#ff7875', sortOrder: 8 },
    ],
  });

  await prisma.settingItem.createMany({
    data: [
      { key: 'allocation.rules', group: 'allocation', description: '排宿规则：OFF 关闭 / SOFT 提醒 / HARD 拦截', value: JSON.stringify(DEFAULT_RULES) },
      { key: 'leave.warningDays', group: 'leave', description: '休假到期提前提醒天数', value: '30' },
      { key: 'org.name', group: 'general', description: '组织名称', value: JSON.stringify('青山工业园区（IMIP）') },
      { key: 'locale.default', group: 'general', description: '默认语言 zh / id / en', value: JSON.stringify('zh') },
      { key: 'video.gatewayUrl', group: 'video', description: '视频网关地址（后期接监控时填，如 http://10.0.0.9:1984）', value: JSON.stringify('') },
    ],
  });

  const nats = await prisma.nationality.findMany();
  const depts = await prisma.department.findMany();
  const levels = await prisma.positionLevel.findMany();
  const shifts = await prisma.shift.findMany();
  const contractors = await prisma.contractor.findMany();
  const roomTypes = await prisma.roomType.findMany();
  const rtByCode = Object.fromEntries(roomTypes.map((r) => [r.code, r]));

  // -------------------------------------------------- 空间
  console.log('生成楼栋 / 楼层 / 房间 / 床位…');
  const site = await prisma.site.create({
    data: { code: 'IMIP', name: '青山工业园区（IMIP）', address: 'Bahodopi, Morowali, Sulawesi Tengah, Indonesia' },
  });

  let roomRows: any[] = [];
  let bedRows: any[] = [];

  for (const [bi, cfg] of BUILDINGS.entries()) {
    const building = await prisma.building.create({
      data: {
        siteId: site.id, code: cfg.code, name: cfg.name,
        genderPolicy: cfg.gender, nationalityId: cfg.nationality,
        note: cfg.note, sortOrder: bi,
      },
    });

    for (let lv = 1; lv <= cfg.floors; lv++) {
      const floorNat = cfg.floorNationality ? (cfg.floorNationality[lv] ?? null) : null;
      const floor = await prisma.floor.create({
        data: {
          buildingId: building.id, level: lv, name: `${lv} 层`,
          nationalityId: floorNat,
        },
      });

      const mixEntries = Object.entries(cfg.mix) as [string, number][];
      for (let r = 1; r <= cfg.roomsPerFloor; r++) {
        const typeCode = weighted(mixEntries);
        const rt = rtByCode[typeCode];
        const roomNo = lv * 100 + r;
        const code = `${cfg.code}-${roomNo}`;
        // 2% 房间处于维修，隔离房默认封存
        const status = typeCode === 'QUAR' ? 'LOCKED' : rnd() < 0.02 ? 'MAINTENANCE' : 'AVAILABLE';
        roomRows.push({
          floorId: floor.id, code, name: `${roomNo} 房`, roomTypeId: rt.id,
          capacity: rt.defaultCapacity, status,
          hasAC: ['ENG2', 'CADRE1', 'EXPERT', 'HOTEL'].includes(typeCode) || rnd() < 0.35,
          hasBathroom: ['ENG2', 'CADRE1', 'EXPERT', 'HOTEL', 'STD4'].includes(typeCode),
          area: rt.defaultCapacity * 4.5 + randInt(0, 6),
        });
      }
    }
  }
  await prisma.room.createMany({ data: roomRows });

  const rooms = await prisma.room.findMany({ select: { id: true, code: true, capacity: true } });
  for (const room of rooms) {
    const layout = BED_LAYOUT[room.capacity] ?? BED_LAYOUT[6];
    layout.forEach((b, i) => {
      bedRows.push({
        roomId: room.id, code: `${room.code}-${i + 1}`, label: b.label,
        position: b.position, status: 'FREE',
      });
    });
  }
  await prisma.bed.createMany({ data: bedRows });
  console.log(`  楼栋 ${BUILDINGS.length} / 房间 ${roomRows.length} / 床位 ${bedRows.length}`);

  // -------------------------------------------------- 人员
  console.log(`生成 ${TOTAL_PEOPLE} 名人员…`);
  const natWeights = [['ID', 0.6], ['CN', 0.355], ['KR', 0.015], ['DE', 0.01], ['VN', 0.02]] as const;
  const lvWeights = [['WORKER', 0.72], ['ENGINEER', 0.15], ['SECTION', 0.07], ['DIVISION', 0.035], ['MANAGER', 0.019], ['GM', 0.006]] as const;
  const statusWeights = [['ACTIVE', 0.88], ['ON_LEAVE', 0.08], ['RESIGNED', 0.04]] as const;
  const lvByCode = Object.fromEntries(levels.map((l) => [l.code, l]));

  const personRows: any[] = [];
  for (let i = 0; i < TOTAL_PEOPLE; i++) {
    const natId = weighted(natWeights);
    const gender = rnd() < 0.07 ? 'FEMALE' : 'MALE';
    let name: string;
    let nameLocal: string | null = null;
    if (natId === 'CN') {
      name = pick(CN_SURNAME) + (gender === 'MALE' ? pick(CN_GIVEN_M) : pick(CN_GIVEN_F));
      nameLocal = null;
    } else if (natId === 'ID') {
      name = `${gender === 'MALE' ? pick(ID_GIVEN_M) : pick(ID_GIVEN_F)} ${pick(ID_SURNAME)}`;
    } else if (natId === 'KR') name = pick(KR_NAME);
    else if (natId === 'DE') name = pick(DE_NAME);
    else name = pick(VN_NAME);

    const lvCode = weighted(lvWeights);
    const level = lvByCode[lvCode];
    const employmentStatus = weighted(statusWeights);
    // 承包商工人主要是印尼籍和中方施工人员
    const contractor =
      natId === 'ID' && rnd() < 0.35 ? pick(contractors.filter((c) => !c.isSelf && c.code.startsWith('PT')))
      : natId === 'CN' && rnd() < 0.12 ? contractors.find((c) => c.code === 'CN-CONST')!
      : contractors.find((c) => c.isSelf)!;

    const dept = pick(depts);
    // 常日班给管理和职能部门，一线三班倒
    const shift =
      level.rank >= 30 || ['HR', 'FIN', 'PROC', 'ADMIN'].includes(dept.code)
        ? shifts.find((s) => s.code === 'ADMIN')!
        : rnd() < 0.5 ? shifts.find((s) => s.code === 'DAY')! : shifts.find((s) => s.code === 'NIGHT')!;

    const hireDate = daysAgo(randInt(30, 2200));
    // 本轮休假起算日：在休假周期内的随机一点，用来推算下次休假
    const cycleDays = Math.round(level.leaveCycleMonths * 30.4);
    const cycleStartDate = daysAgo(randInt(0, cycleDays + 20));

    personRows.push({
      employeeNo: `${natId}${String(100001 + i).slice(1)}`,
      name, nameLocal, gender, nationalityId: natId,
      idType: natId === 'ID' ? 'KTP' : 'PASSPORT',
      idNumber: natId === 'ID'
        ? `72${String(randInt(10000000000000, 99999999999999))}`.slice(0, 16)
        : `${natId[0]}${randInt(10000000, 99999999)}`,
      departmentId: dept.id,
      positionLevelId: level.id,
      positionTitle: `${dept.nameZh}${level.nameZh}`,
      shiftId: shift.id,
      contractorId: contractor.id,
      phone: `+62 8${randInt(10, 99)}-${randInt(1000, 9999)}-${randInt(1000, 9999)}`,
      hireDate, employmentStatus, cycleStartDate,
    });
  }
  await prisma.person.createMany({ data: personRows });

  // -------------------------------------------------- 排宿
  console.log('按规则排宿…');
  const persons = await prisma.person.findMany({
    include: { positionLevel: true, contractor: true },
  });
  const allRooms = await prisma.room.findMany({
    include: {
      roomType: true,
      beds: true,
      floor: { include: { building: true } },
    },
  });

  interface RoomCtx {
    room: (typeof allRooms)[number];
    genderPolicy: string | null;
    nationalityId: string | null;
    minRank: number | null;
    freeBeds: number[];
    occupants: PersonLike[];
  }
  const roomCtxs: RoomCtx[] = allRooms.map((room) => {
    const bld = room.floor.building;
    const gp = room.genderPolicy ?? room.floor.genderPolicy ?? bld.genderPolicy;
    return {
      room,
      genderPolicy: gp === 'MIXED' ? null : gp,
      nationalityId: room.nationalityId ?? room.floor.nationalityId ?? bld.nationalityId,
      minRank: room.roomType.minPositionRank,
      freeBeds: room.beds.map((b) => b.id),
      occupants: [],
    };
  });

  const toPersonLike = (p: (typeof persons)[number]): PersonLike => ({
    id: p.id, name: p.name, gender: p.gender, nationalityId: p.nationalityId,
    departmentId: p.departmentId, positionLevelId: p.positionLevelId,
    shiftId: p.shiftId, contractorId: p.contractorId,
    positionRank: p.positionLevel.rank, contractorIsSelf: p.contractor.isSelf,
  });

  const totalBeds = bedRows.length;
  const targetAssign = Math.min(Math.floor(totalBeds * TARGET_OCCUPANCY), persons.length);

  // 职级高的先排，保证干部房 / 专家公寓被正确占用
  const queue = persons
    .filter((p) => p.employmentStatus !== 'RESIGNED')
    .sort((a, b) => b.positionLevel.rank - a.positionLevel.rank);

  const occupancyRows: any[] = [];
  const bedStatusUpdates = new Map<number, string>();
  let assigned = 0;

  for (const p of queue) {
    if (assigned >= targetAssign) break;
    const pl = toPersonLike(p);

    let best: { ctx: RoomCtx; score: number } | null = null;
    for (const ctx of roomCtxs) {
      if (ctx.freeBeds.length === 0) continue;
      if (ctx.room.status !== 'AVAILABLE') continue;
      const checks = evaluateAssignment(pl, {
        roomStatus: ctx.room.status,
        roomCapacity: ctx.room.capacity,
        currentOccupantCount: ctx.occupants.length,
        genderPolicy: ctx.genderPolicy,
        nationalityId: ctx.nationalityId,
        minPositionRank: ctx.minRank,
        roomTypeName: ctx.room.roomType.nameZh,
        occupants: ctx.occupants.map((o) => ({
          shiftId: o.shiftId, departmentId: o.departmentId,
          contractorIsSelf: o.contractorIsSelf, gender: o.gender, nationalityId: o.nationalityId,
        })),
      });
      const { blockers, warnings } = splitChecks(checks);
      if (blockers.length > 0) continue;

      // 打分：软约束满足得分越高；已开住的房间优先填满；高职级优先高等级房型
      let score = 100 - warnings.length * 12;
      if (ctx.nationalityId === p.nationalityId) score += 25;
      if (ctx.occupants.length > 0) score += 8;
      if (ctx.minRank !== null) score += Math.min(ctx.minRank, p.positionLevel.rank) / 2;
      score += rnd() * 6; // 少量随机，避免全部堆在同一栋
      if (!best || score > best.score) best = { ctx, score };
    }
    if (!best) continue;

    const bedId = best.ctx.freeBeds.shift()!;
    best.ctx.occupants.push(pl);
    const onLeave = p.employmentStatus === 'ON_LEAVE';
    occupancyRows.push({
      bedId, personId: p.id,
      checkInAt: daysAgo(randInt(1, 900)),
      status: onLeave ? 'HELD' : 'ACTIVE',
      assignedBy: 'seed',
      note: onLeave ? '休假回国，床位保留' : null,
    });
    bedStatusUpdates.set(bedId, onLeave ? 'HELD' : 'OCCUPIED');
    assigned++;
  }

  // 故意留一批「已离职但床位没释放」的脏数据 —— 这是宿管系统头号死因，仪表盘要能报警
  const resigned = persons.filter((p) => p.employmentStatus === 'RESIGNED');
  let dirty = 0;
  for (const p of resigned) {
    if (dirty >= RESIGNED_STILL_HOLDING_BED) break;
    const ctx = roomCtxs.find((c) => c.freeBeds.length > 0 && c.room.status === 'AVAILABLE' && (!c.genderPolicy || c.genderPolicy === p.gender));
    if (!ctx) break;
    const bedId = ctx.freeBeds.shift()!;
    ctx.occupants.push(toPersonLike(p));
    occupancyRows.push({
      bedId, personId: p.id, checkInAt: daysAgo(randInt(200, 800)),
      status: 'ACTIVE', assignedBy: 'seed', note: '离职未办理退宿',
    });
    bedStatusUpdates.set(bedId, 'OCCUPIED');
    dirty++;
  }

  await prisma.occupancy.createMany({ data: occupancyRows });
  for (const [status, ids] of groupByStatus(bedStatusUpdates)) {
    await prisma.bed.updateMany({ where: { id: { in: ids } }, data: { status } });
  }
  // 少量床位报修
  const freeBedIds = (await prisma.bed.findMany({ where: { status: 'FREE' }, select: { id: true } })).map((b) => b.id);
  const brokenIds = freeBedIds.filter(() => rnd() < 0.015);
  if (brokenIds.length) {
    await prisma.bed.updateMany({ where: { id: { in: brokenIds } }, data: { status: 'MAINTENANCE', note: '床架损坏待修' } });
  }
  console.log(`  已排宿 ${occupancyRows.length} 人（含 ${dirty} 条离职未退宿的脏数据）`);

  // 入住流水（只给最近的记录补，够演示即可）
  const recentOcc = await prisma.occupancy.findMany({ take: 200, orderBy: { id: 'desc' } });
  await prisma.occupancyEvent.createMany({
    data: recentOcc.map((o) => ({
      type: 'CHECKIN', personId: o.personId, bedId: o.bedId,
      operator: 'seed', createdAt: o.checkInAt, note: '初始化导入',
    })),
  });

  // -------------------------------------------------- 设备（为监控预留）
  console.log('登记设备占位（门禁 / 电表 / 摄像头预留）…');
  const floors = await prisma.floor.findMany({ include: { building: true } });
  const deviceRows: any[] = [];
  for (const f of floors) {
    deviceRows.push({
      type: 'DOOR', name: `${f.building.code}栋 ${f.level}层 门禁`,
      scopeType: 'FLOOR', scopeId: f.id, vendor: 'HIKVISION',
      ipAddress: `10.20.${f.building.sortOrder + 1}.${100 + f.level}`, isActive: true,
    });
    // 楼道摄像头：一期只登记点位，不启用，不接码流
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
  await prisma.device.createMany({ data: deviceRows });

  // -------------------------------------------------- 汇总
  const [bedCount, occCount] = await Promise.all([
    prisma.bed.count(),
    prisma.occupancy.count({ where: { status: { in: ['ACTIVE', 'HELD'] } } }),
  ]);
  console.log('\n完成：');
  console.log(`  床位 ${bedCount}，在住/保留 ${occCount}，入住率 ${((occCount / bedCount) * 100).toFixed(1)}%`);
  console.log(`  人员 ${TOTAL_PEOPLE}，设备点位 ${deviceRows.length}`);
}

function groupByStatus(m: Map<number, string>): Array<[string, number[]]> {
  const out = new Map<string, number[]>();
  for (const [id, st] of m) {
    if (!out.has(st)) out.set(st, []);
    out.get(st)!.push(id);
  }
  return [...out.entries()];
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
