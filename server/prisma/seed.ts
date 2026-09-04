/**
 * 模拟数据生成器
 *
 * 一期没有真实花名册，这里按青山园区的实际形态生成一整套可信的假数据，
 * 覆盖实际运营里真会发生的情况：
 *   - 8 栋楼、层数不等（4 / 6 / 8 层），国籍分区做到楼层级
 *   - 房型齐全：单人间 / 双人间 / 三人间 / 四人间 / 六人间 / 八人间 /
 *     夫妻房 / 家庭房 / 干部单间 / 专家公寓 / 酒店式客房 / 隔离房 / 中转房 / 值班房
 *   - 功能房（洗衣房 / 祷告室 / 活动室 / 宿管室 / 储藏室）占楼层空间但不住人
 *   - 「四人间实际住三人」：核定人数低于房型标称，多余床位标记为撤除并留下原因
 *   - 夫妻双职工与家属随迁（配偶不是员工），挂靠关系 + 已核验的配偶关系
 *   - 物品发放 / 押金 / 报修工单 / 违规记录 / 访客登记 / 查寝 / 公告 / 申请审批
 *
 * 规模与比例都在文件顶部常量里，随时可调。
 * 重新生成：npm run db:seed（会先清空业务数据）
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_RULES } from '../src/services/rules.js';
import { seedPlatform } from './seed-platform.js';
import { bedLayoutFor } from '../src/services/space.js';

const prisma = new PrismaClient();

// ---------------------------------------------------------------- 可调参数
const TOTAL_EMPLOYEES = 2500;
const COUPLE_BOTH_EMPLOYEE = 45; // 夫妻双职工对数
const COUPLE_WITH_DEPENDENT = 40; // 配偶为家属（非员工）的对数
const CHILD_DEPENDENTS = 18; // 随迁子女
const TARGET_OCCUPANCY = 0.87;
const RESIGNED_STILL_HOLDING_BED = 18; // 故意制造的「离职未退宿」脏数据
const RNG_SEED = 20260902;

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(RNG_SEED);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const randInt = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const chance = (p: number) => rnd() < p;
function weighted<T>(weights: readonly (readonly [T, number])[]): T {
  const total = weights.reduce((s, w) => s + w[1], 0);
  let r = rnd() * total;
  for (const [v, w] of weights) { r -= w; if (r <= 0) return v; }
  return weights[weights.length - 1][0];
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86400000);

/** SQLite 有参数上限，大批量写入要分片 */
async function createManyChunked(model: any, rows: any[], size = 400) {
  for (let i = 0; i < rows.length; i += size) {
    await model.createMany({ data: rows.slice(i, i + size) });
  }
}

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

const BUILDINGS: BuildingCfg[] = [
  { code: 'A', name: 'A栋 中方员工宿舍', gender: 'MALE', nationality: 'CN', floors: 8, roomsPerFloor: 14,
    mix: { SIX: 0.6, EIGHT: 0.2, QUAD: 0.2 } },
  { code: 'B', name: 'B栋 中方员工宿舍', gender: 'MALE', nationality: 'CN', floors: 6, roomsPerFloor: 14,
    mix: { SIX: 0.5, QUAD: 0.3, TRIPLE: 0.2 } },
  { code: 'C', name: 'C栋 印尼籍员工宿舍', gender: 'MALE', nationality: 'ID', floors: 6, roomsPerFloor: 16,
    mix: { EIGHT: 0.5, SIX: 0.5 } },
  { code: 'D', name: 'D栋 印尼籍员工宿舍', gender: 'MALE', nationality: 'ID', floors: 4, roomsPerFloor: 16,
    mix: { EIGHT: 0.6, SIX: 0.4 } },
  { code: 'E', name: 'E栋 混合宿舍', gender: 'MALE', nationality: null, floors: 6, roomsPerFloor: 12,
    floorNationality: { 1: 'ID', 2: 'ID', 3: 'CN', 4: 'CN', 5: null, 6: null },
    mix: { SIX: 0.5, QUAD: 0.3, DOUBLE: 0.2 },
    note: '一、二层印尼籍，三、四层中方，五、六层不限国籍（含韩德越等外籍）' },
  { code: 'F', name: 'F栋 女员工宿舍', gender: 'FEMALE', nationality: null, floors: 4, roomsPerFloor: 12,
    floorNationality: { 1: 'ID', 2: 'ID', 3: 'CN', 4: null },
    mix: { QUAD: 0.5, DOUBLE: 0.3, TRIPLE: 0.2 } },
  { code: 'G', name: 'G栋 干部楼 / 专家公寓', gender: 'MIXED', nationality: null, floors: 4, roomsPerFloor: 10,
    hasElevator: true, mix: { CADRE: 0.4, EXPERT: 0.25, DOUBLE: 0.2, SINGLE: 0.15 },
    note: '中层及以上专用，含值班单间' },
  { code: 'H', name: 'H栋 家属楼 / 酒店式公寓', gender: 'MIXED', nationality: null, floors: 8, roomsPerFloor: 12,
    hasElevator: true, mix: { COUPLE: 0.45, FAMILY: 0.12, HOTEL: 0.28, QUARANTINE: 0.08, TRANSIT: 0.07 },
    note: '夫妻房与家属随迁房、酒店式短住、隔离房都在这栋，按需审批入住' },
];

/** 每层固定配的功能房（占楼层空间但不住人） */
const FLOOR_FUNCTION_ROOMS: Array<{ type: string; onFloor?: 'FIRST' | 'ALL'; onlyNationality?: string }> = [
  { type: 'LAUNDRY', onFloor: 'ALL' },
  { type: 'DORM_OFFICE', onFloor: 'FIRST' },
  { type: 'PRAYER', onFloor: 'FIRST' },
  { type: 'ACTIVITY', onFloor: 'FIRST' },
];

/** 摆床规格与批量导入共用同一份实现，见 services/space.ts */
const bedLayout = bedLayoutFor;

// ================================================================ main
async function main() {
  console.log('清空旧数据…');
  const order = [
    'auditLog', 'notification', 'notificationTemplate', 'syncLog', 'identityBinding', 'integration',
    'inspectionItem', 'inspection', 'visitor', 'violation', 'workOrder',
    'deposit', 'issuedItem', 'request', 'occupancyEvent', 'occupancy',
    'relationship', 'person', 'asset', 'bed', 'room', 'floor',
    'userBuilding', 'user', 'role', 'building', 'site', 'device',
    'announcement', 'workOrderCategory', 'violationType', 'itemType',
    'roomType', 'contractor', 'shift', 'religion', 'positionLevel',
    'department', 'nationality', 'settingItem',
  ];
  for (const m of order) await (prisma as any)[m].deleteMany();

  // ============================== 字典 ==============================
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

  await prisma.department.createMany({
    data: [
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
      ['DORM', '宿舍管理科', 'Dormitory Management', 'Manajemen Asrama'],
    ].map(([code, zh, en, id], i) => ({ code, nameZh: zh, nameEn: en, nameId: id, sortOrder: i })),
  });

  await prisma.positionLevel.createMany({
    data: [
      { code: 'WORKER', nameZh: '普通员工', nameEn: 'Worker', nameId: 'Karyawan', rank: 10, leaveCycleMonths: 6, isLeadership: false, coupleRoomAllowed: false },
      { code: 'ENGINEER', nameZh: '工程师', nameEn: 'Engineer', nameId: 'Insinyur', rank: 20, leaveCycleMonths: 5.5, isLeadership: false, coupleRoomAllowed: true },
      { code: 'SECTION', nameZh: '科长', nameEn: 'Section Chief', nameId: 'Kepala Seksi', rank: 30, leaveCycleMonths: 5.5, isLeadership: false, coupleRoomAllowed: true },
      { code: 'DIVISION', nameZh: '部长', nameEn: 'Division Head', nameId: 'Kepala Divisi', rank: 40, leaveCycleMonths: 4.5, isLeadership: true, coupleRoomAllowed: true },
      { code: 'MANAGER', nameZh: '经理', nameEn: 'Manager', nameId: 'Manajer', rank: 50, leaveCycleMonths: 4.5, isLeadership: true, coupleRoomAllowed: true },
      { code: 'GM', nameZh: '总经理', nameEn: 'General Manager', nameId: 'Manajer Umum', rank: 60, leaveCycleMonths: 3, isLeadership: true, coupleRoomAllowed: true },
    ],
  });

  await prisma.shift.createMany({
    data: [
      { code: 'DAY', nameZh: '白班', nameEn: 'Day Shift', nameId: 'Sif Siang', startTime: '08:00', endTime: '20:00', color: '#faad14' },
      { code: 'NIGHT', nameZh: '夜班', nameEn: 'Night Shift', nameId: 'Sif Malam', startTime: '20:00', endTime: '08:00', color: '#2f54eb' },
      { code: 'ADMIN', nameZh: '常日班', nameEn: 'Office Hours', nameId: 'Jam Kantor', startTime: '08:00', endTime: '17:00', color: '#52c41a' },
    ],
  });

  await prisma.religion.createMany({
    data: [
      { code: 'ISLAM', nameZh: '伊斯兰教', nameEn: 'Islam', nameId: 'Islam', hasDietaryRule: true },
      { code: 'CHRISTIAN', nameZh: '基督教', nameEn: 'Christianity', nameId: 'Kristen', hasDietaryRule: false },
      { code: 'CATHOLIC', nameZh: '天主教', nameEn: 'Catholicism', nameId: 'Katolik', hasDietaryRule: false },
      { code: 'HINDU', nameZh: '印度教', nameEn: 'Hinduism', nameId: 'Hindu', hasDietaryRule: true },
      { code: 'BUDDHIST', nameZh: '佛教', nameEn: 'Buddhism', nameId: 'Buddha', hasDietaryRule: false },
      { code: 'NONE', nameZh: '无 / 未登记', nameEn: 'None', nameId: 'Tidak Ada', hasDietaryRule: false },
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

  // 房型 —— 规格 / 门槛 / 管理模式全部可配
  await prisma.roomType.createMany({
    data: [
      { code: 'SINGLE', nameZh: '单人间', nameEn: 'Single Room', nameId: 'Kamar Single', defaultCapacity: 1, dailyRate: 45, color: '#1677ff', sortOrder: 1 },
      { code: 'DOUBLE', nameZh: '双人间', nameEn: 'Twin Room', nameId: 'Kamar Twin', defaultCapacity: 2, dailyRate: 35, color: '#4096ff', sortOrder: 2 },
      { code: 'TRIPLE', nameZh: '三人间', nameEn: 'Triple Room', nameId: 'Kamar Triple', defaultCapacity: 3, dailyRate: 26, color: '#69b1ff', sortOrder: 3 },
      { code: 'QUAD', nameZh: '四人间', nameEn: '4-Bed Room', nameId: 'Kamar 4 Orang', defaultCapacity: 4, dailyRate: 20, color: '#91caff', sortOrder: 4 },
      { code: 'SIX', nameZh: '六人间', nameEn: '6-Bed Room', nameId: 'Kamar 6 Orang', defaultCapacity: 6, dailyRate: 15, color: '#bae0ff', sortOrder: 5 },
      { code: 'EIGHT', nameZh: '八人间', nameEn: '8-Bed Room', nameId: 'Kamar 8 Orang', defaultCapacity: 8, dailyRate: 12, color: '#e6f4ff', sortOrder: 6 },
      { code: 'COUPLE', nameZh: '夫妻房', nameEn: 'Couple Room', nameId: 'Kamar Suami Istri', defaultCapacity: 2, dailyRate: 55, color: '#eb2f96', sortOrder: 7, isCoupleRoom: true, allowMixedGender: true, allowDependents: true },
      { code: 'FAMILY', nameZh: '家庭房', nameEn: 'Family Room', nameId: 'Kamar Keluarga', defaultCapacity: 4, dailyRate: 70, color: '#f759ab', sortOrder: 8, isCoupleRoom: true, allowMixedGender: true, allowDependents: true },
      { code: 'CADRE', nameZh: '干部单间', nameEn: 'Supervisor Single', nameId: 'Kamar Pimpinan', defaultCapacity: 1, minPositionRank: 40, dailyRate: 60, color: '#0958d9', sortOrder: 9 },
      { code: 'EXPERT', nameZh: '专家公寓', nameEn: 'Expert Apartment', nameId: 'Apartemen Ahli', defaultCapacity: 1, minPositionRank: 50, dailyRate: 90, color: '#003eb3', sortOrder: 10 },
      { code: 'HOTEL', nameZh: '酒店式客房', nameEn: 'Hotel Room', nameId: 'Kamar Hotel', managementMode: 'HOTEL', defaultCapacity: 2, dailyRate: 120, color: '#9254de', sortOrder: 11, allowDependents: true, allowMixedGender: true },
      { code: 'QUARANTINE', nameZh: '隔离 / 病号房', nameEn: 'Quarantine Room', nameId: 'Kamar Isolasi', defaultCapacity: 4, dailyRate: 0, color: '#ff7875', sortOrder: 12 },
      { code: 'TRANSIT', nameZh: '中转 / 临时房', nameEn: 'Transit Room', nameId: 'Kamar Transit', defaultCapacity: 6, dailyRate: 10, color: '#ffc069', sortOrder: 13, note: undefined as any },
      // —— 功能房：占楼层空间但不住人 ——
      { code: 'LAUNDRY', nameZh: '洗衣房', nameEn: 'Laundry', nameId: 'Ruang Cuci', defaultCapacity: 0, isResidential: false, color: '#d9d9d9', sortOrder: 20 },
      { code: 'PRAYER', nameZh: '祷告室 (Mushola)', nameEn: 'Prayer Room', nameId: 'Mushola', defaultCapacity: 0, isResidential: false, color: '#95de64', sortOrder: 21 },
      { code: 'ACTIVITY', nameZh: '活动室', nameEn: 'Common Room', nameId: 'Ruang Bersama', defaultCapacity: 0, isResidential: false, color: '#d9d9d9', sortOrder: 22 },
      { code: 'DORM_OFFICE', nameZh: '宿管室', nameEn: 'Warden Office', nameId: 'Kantor Pengelola', defaultCapacity: 0, isResidential: false, color: '#ffd666', sortOrder: 23 },
      { code: 'STORAGE', nameZh: '储藏室', nameEn: 'Storage', nameId: 'Gudang', defaultCapacity: 0, isResidential: false, color: '#d9d9d9', sortOrder: 24 },
    ].map(({ note, ...r }: any) => r),
  });

  await prisma.itemType.createMany({
    data: [
      { code: 'MATTRESS', nameZh: '床垫', nameEn: 'Mattress', nameId: 'Kasur', price: 350, deposit: 0, sortOrder: 1 },
      { code: 'QUILT', nameZh: '被子', nameEn: 'Quilt', nameId: 'Selimut', price: 120, sortOrder: 2 },
      { code: 'PILLOW', nameZh: '枕头', nameEn: 'Pillow', nameId: 'Bantal', price: 40, sortOrder: 3 },
      { code: 'SHEET', nameZh: '床单被套', nameEn: 'Bed Linen', nameId: 'Seprai', price: 80, sortOrder: 4 },
      { code: 'LOCKER_KEY', nameZh: '柜子钥匙', nameEn: 'Locker Key', nameId: 'Kunci Loker', price: 30, deposit: 50, sortOrder: 5 },
      { code: 'ROOM_KEY', nameZh: '房门钥匙', nameEn: 'Room Key', nameId: 'Kunci Kamar', price: 30, deposit: 50, sortOrder: 6 },
      { code: 'ACCESS_CARD', nameZh: '门禁卡', nameEn: 'Access Card', nameId: 'Kartu Akses', price: 25, deposit: 50, sortOrder: 7 },
      { code: 'KETTLE', nameZh: '电热水壶', nameEn: 'Kettle', nameId: 'Ceret Listrik', price: 90, isReturnable: true, sortOrder: 8 },
      { code: 'BUCKET', nameZh: '水桶脸盆', nameEn: 'Bucket & Basin', nameId: 'Ember & Baskom', price: 25, isReturnable: false, sortOrder: 9 },
    ],
  });

  await prisma.violationType.createMany({
    data: [
      { code: 'WIRING', nameZh: '私拉电线', nameEn: 'Illegal Wiring', nameId: 'Instalasi Kabel Liar', severity: 'CRITICAL', defaultPoints: 6, defaultFine: 200 },
      { code: 'HIGH_POWER', nameZh: '使用大功率电器', nameEn: 'High-power Appliance', nameId: 'Alat Listrik Daya Tinggi', severity: 'CRITICAL', defaultPoints: 6, defaultFine: 200 },
      { code: 'OPEN_FLAME', nameZh: '室内明火 / 做饭', nameEn: 'Open Flame / Cooking', nameId: 'Api Terbuka / Memasak', severity: 'CRITICAL', defaultPoints: 8, defaultFine: 300 },
      { code: 'SMOKING', nameZh: '禁烟区吸烟', nameEn: 'Smoking in No-smoking Area', nameId: 'Merokok di Area Terlarang', severity: 'HIGH', defaultPoints: 3, defaultFine: 100 },
      { code: 'OVERNIGHT_GUEST', nameZh: '私自留宿外人', nameEn: 'Unauthorized Overnight Guest', nameId: 'Menginapkan Tamu Tanpa Izin', severity: 'HIGH', defaultPoints: 4, defaultFine: 150 },
      { code: 'ALCOHOL', nameZh: '宿舍内酗酒', nameEn: 'Drinking Alcohol', nameId: 'Minum Alkohol', severity: 'HIGH', defaultPoints: 4, defaultFine: 150 },
      { code: 'GAMBLING', nameZh: '聚众赌博', nameEn: 'Gambling', nameId: 'Perjudian', severity: 'CRITICAL', defaultPoints: 8, defaultFine: 300 },
      { code: 'NOISE', nameZh: '夜间噪音扰民', nameEn: 'Noise Disturbance', nameId: 'Kebisingan', severity: 'MEDIUM', defaultPoints: 2, defaultFine: 50 },
      { code: 'HYGIENE', nameZh: '卫生不合格', nameEn: 'Poor Hygiene', nameId: 'Kebersihan Buruk', severity: 'LOW', defaultPoints: 1, defaultFine: 0 },
      { code: 'ABSENT', nameZh: '查寝未归未报备', nameEn: 'Unreported Absence', nameId: 'Tidak Hadir Tanpa Lapor', severity: 'MEDIUM', defaultPoints: 2, defaultFine: 50 },
      { code: 'DAMAGE', nameZh: '故意损坏公物', nameEn: 'Property Damage', nameId: 'Merusak Fasilitas', severity: 'HIGH', defaultPoints: 4, defaultFine: 0 },
      { code: 'SWAP_BED', nameZh: '私自调换床位', nameEn: 'Unauthorized Bed Swap', nameId: 'Tukar Tempat Tidur Tanpa Izin', severity: 'MEDIUM', defaultPoints: 2, defaultFine: 50 },
    ],
  });

  await prisma.workOrderCategory.createMany({
    data: [
      { code: 'PLUMBING', nameZh: '水暖 / 漏水', nameEn: 'Plumbing', nameId: 'Perpipaan', slaHours: 24, blocksByDefault: true },
      { code: 'ELECTRIC', nameZh: '电路 / 照明', nameEn: 'Electrical', nameId: 'Kelistrikan', slaHours: 12, blocksByDefault: true },
      { code: 'AC', nameZh: '空调', nameEn: 'Air Conditioning', nameId: 'AC', slaHours: 48 },
      { code: 'DOOR', nameZh: '门窗 / 门锁', nameEn: 'Door & Lock', nameId: 'Pintu & Kunci', slaHours: 24 },
      { code: 'FURNITURE', nameZh: '家具 / 床架', nameEn: 'Furniture', nameId: 'Perabot', slaHours: 72 },
      { code: 'WATER_HEATER', nameZh: '热水器', nameEn: 'Water Heater', nameId: 'Pemanas Air', slaHours: 48 },
      { code: 'NETWORK', nameZh: '网络 / 电视', nameEn: 'Network & TV', nameId: 'Jaringan & TV', slaHours: 72 },
      { code: 'PEST', nameZh: '虫害消杀', nameEn: 'Pest Control', nameId: 'Pengendalian Hama', slaHours: 48 },
      { code: 'CLEANING', nameZh: '保洁', nameEn: 'Cleaning', nameId: 'Kebersihan', slaHours: 24 },
      { code: 'OTHER', nameZh: '其他', nameEn: 'Other', nameId: 'Lainnya', slaHours: 72 },
    ],
  });

  await prisma.role.createMany({
    data: [
      { code: 'ADMIN', nameZh: '系统管理员', nameEn: 'System Admin', nameId: 'Admin Sistem', permissions: '*' },
      { code: 'DORM_MANAGER', nameZh: '宿舍主管', nameEn: 'Dormitory Manager', nameId: 'Manajer Asrama', permissions: 'space:*,person:*,allocation:*,report:*,workorder:*,violation:*,inspection:*' },
      { code: 'WARDEN', nameZh: '楼栋宿管', nameEn: 'Building Warden', nameId: 'Pengelola Gedung', permissions: 'space:read,person:read,allocation:*,workorder:*,violation:create,inspection:*,visitor:*' },
      { code: 'HR', nameZh: '人力资源', nameEn: 'HR', nameId: 'SDM', permissions: 'person:*,report:read' },
      { code: 'EHS', nameZh: '安全环保', nameEn: 'EHS', nameId: 'K3', permissions: 'report:read,violation:*,inspection:*' },
      { code: 'VIEWER', nameZh: '只读查看', nameEn: 'Viewer', nameId: 'Pembaca', permissions: 'report:read,space:read' },
    ],
  });

  await prisma.settingItem.createMany({
    data: [
      { key: 'allocation.rules', group: 'allocation', description: '排宿规则：OFF 关闭 / SOFT 提醒 / HARD 拦截', value: JSON.stringify(DEFAULT_RULES) },
      { key: 'leave.warningDays', group: 'leave', description: '休假到期提前提醒天数', value: '30' },
      { key: 'id.expiryWarningDays', group: 'compliance', description: '证件（护照 / KITAS）到期提前提醒天数', value: '90' },
      { key: 'leave.autoReleaseDays', group: 'leave', description: '休假超过多少天自动释放床位（0 = 一律保留）', value: '0' },
      { key: 'reserved.staleDays', group: 'allocation', description: '已分配多少天未入住算超期', value: '3' },
      { key: 'violation.pointsThreshold', group: 'violation', description: '违规累计扣分达到多少触发处理', value: '10' },
      { key: 'org.name', group: 'general', description: '组织名称', value: JSON.stringify('青山工业园区（IMIP）') },
      { key: 'locale.default', group: 'general', description: '默认语言 zh / id / en', value: JSON.stringify('zh') },
      { key: 'video.gatewayUrl', group: 'video', description: '视频网关地址（后期接监控时填，如 http://10.0.0.9:1984）', value: JSON.stringify('') },
    ],
  });

  const depts = await prisma.department.findMany();
  const levels = await prisma.positionLevel.findMany();
  const shifts = await prisma.shift.findMany();
  const contractors = await prisma.contractor.findMany();
  const religions = await prisma.religion.findMany();
  const roomTypes = await prisma.roomType.findMany();
  const itemTypes = await prisma.itemType.findMany();
  const violationTypes = await prisma.violationType.findMany();
  const woCategories = await prisma.workOrderCategory.findMany();
  const roles = await prisma.role.findMany();
  const rtByCode: Record<string, any> = Object.fromEntries(roomTypes.map((r) => [r.code, r]));
  const lvByCode: Record<string, any> = Object.fromEntries(levels.map((l) => [l.code, l]));
  const relByCode: Record<string, any> = Object.fromEntries(religions.map((r) => [r.code, r]));

  // ============================== 空间 ==============================
  console.log('生成楼栋 / 楼层 / 房间 / 床位…');
  const site = await prisma.site.create({
    data: { code: 'IMIP', name: '青山工业园区（IMIP）', address: 'Bahodopi, Morowali, Sulawesi Tengah, Indonesia' },
  });

  const roomRows: any[] = [];
  const buildingIds: Record<string, number> = {};

  for (const [bi, cfg] of BUILDINGS.entries()) {
    const building = await prisma.building.create({
      data: {
        siteId: site.id, code: cfg.code, name: cfg.name,
        genderPolicy: cfg.gender, nationalityId: cfg.nationality,
        hasElevator: cfg.hasElevator ?? false,
        note: cfg.note, sortOrder: bi,
      },
    });
    buildingIds[cfg.code] = building.id;

    for (let lv = 1; lv <= cfg.floors; lv++) {
      const floorNat = cfg.floorNationality ? (cfg.floorNationality[lv] ?? null) : null;
      const floor = await prisma.floor.create({
        data: { buildingId: building.id, level: lv, name: `${lv} 层`, nationalityId: floorNat },
      });

      const mixEntries = Object.entries(cfg.mix) as [string, number][];
      let seq = 0;

      // 住宿房间
      for (let r = 1; r <= cfg.roomsPerFloor; r++) {
        seq++;
        const typeCode = weighted(mixEntries);
        const rt = rtByCode[typeCode];
        const roomNo = lv * 100 + seq;
        const code = `${cfg.code}-${roomNo}`;

        // 核定人数：多数等于标称；一部分降标（四人间按三人住、六人间按五人住）
        let capacity = rt.defaultCapacity;
        let deratedReason: string | null = null;
        if (rt.defaultCapacity >= 4 && rt.isResidential && chance(0.22)) {
          capacity = rt.defaultCapacity - 1;
          deratedReason = pick([
            '空调制冷量不足，按低一档人数配置',
            '房间面积偏小，安全通道要求降标',
            '一张床架损坏已撤除，暂按低一档配置',
            '员工投诉过于拥挤，主管批准降标',
          ]);
        }

        const status =
          typeCode === 'QUARANTINE' ? 'LOCKED'
          : chance(0.02) ? 'MAINTENANCE'
          : chance(0.01) ? 'CLEANING'
          : 'AVAILABLE';

        roomRows.push({
          floorId: floor.id, code, name: `${roomNo} 房`, roomTypeId: rt.id,
          capacity, deratedReason, status,
          hasAC: ['DOUBLE', 'SINGLE', 'CADRE', 'EXPERT', 'HOTEL', 'COUPLE', 'FAMILY'].includes(typeCode) || chance(0.35),
          hasBathroom: ['DOUBLE', 'SINGLE', 'CADRE', 'EXPERT', 'HOTEL', 'COUPLE', 'FAMILY', 'QUAD', 'TRIPLE'].includes(typeCode),
          hasWaterHeater: ['CADRE', 'EXPERT', 'HOTEL', 'COUPLE', 'FAMILY'].includes(typeCode) || chance(0.2),
          hasBalcony: chance(0.25),
          orientation: pick(['南', '北', '东', '西']),
          area: Math.max(rt.defaultCapacity, 1) * 4.5 + randInt(0, 8),
          _typeCode: typeCode,
        });
      }

      // 功能房
      for (const fr of FLOOR_FUNCTION_ROOMS) {
        if (fr.onFloor === 'FIRST' && lv !== 1) continue;
        if (fr.type === 'PRAYER' && !(cfg.nationality === 'ID' || cfg.floorNationality)) continue;
        seq++;
        const rt = rtByCode[fr.type];
        const roomNo = lv * 100 + seq;
        roomRows.push({
          floorId: floor.id, code: `${cfg.code}-${roomNo}`, name: rt.nameZh,
          roomTypeId: rt.id, capacity: 0, status: 'AVAILABLE',
          hasAC: fr.type === 'DORM_OFFICE', hasBathroom: false,
          area: randInt(12, 40), _typeCode: fr.type,
        });
      }
    }
  }

  const roomTypeCodeByIndex = roomRows.map((r) => r._typeCode);
  await createManyChunked(prisma.room, roomRows.map(({ _typeCode, ...r }) => r));

  // 床位：按房型标称摆床，超出核定人数的部分标记为 DISABLED（撤除留痕）
  const rooms = await prisma.room.findMany({
    select: { id: true, code: true, capacity: true, roomTypeId: true },
    orderBy: { id: 'asc' },
  });
  const rtById: Record<number, any> = Object.fromEntries(roomTypes.map((r) => [r.id, r]));
  const bedRows: any[] = [];
  for (const room of rooms) {
    const rt = rtById[room.roomTypeId];
    if (!rt.isResidential) continue;
    const layout = bedLayout(rt.defaultCapacity, rt.code);
    layout.forEach((b, i) => {
      const beyond = i >= room.capacity;
      bedRows.push({
        roomId: room.id, code: `${room.code}-${i + 1}`, label: b.label,
        position: b.position,
        status: beyond ? 'DISABLED' : 'FREE',
        note: beyond ? '按核定人数降标撤除' : null,
      });
    });
  }
  await createManyChunked(prisma.bed, bedRows);

  // 房间固定资产
  const assetRows: any[] = [];
  const allRoomsFull = await prisma.room.findMany({ include: { roomType: true } });
  for (const room of allRoomsFull) {
    if (!room.roomType.isResidential) continue;
    if (room.hasAC) assetRows.push({ roomId: room.id, category: 'AC', name: '壁挂空调', assetNo: `AC-${room.code}`, status: chance(0.05) ? 'BROKEN' : 'NORMAL' });
    else assetRows.push({ roomId: room.id, category: 'FAN', name: '吊扇', assetNo: `FAN-${room.code}`, status: 'NORMAL' });
    if (room.hasWaterHeater) assetRows.push({ roomId: room.id, category: 'WATER_HEATER', name: '电热水器', assetNo: `WH-${room.code}`, status: chance(0.06) ? 'BROKEN' : 'NORMAL' });
    assetRows.push({ roomId: room.id, category: 'DESK', name: '书桌椅', assetNo: `DK-${room.code}`, status: 'NORMAL' });
  }
  await createManyChunked(prisma.asset, assetRows);
  console.log(`  楼栋 ${BUILDINGS.length} / 房间 ${roomRows.length}（含功能房 ${roomTypeCodeByIndex.filter((c) => !rtByCode[c].isResidential).length}）/ 床位 ${bedRows.length} / 资产 ${assetRows.length}`);

  // ============================== 人员 ==============================
  console.log(`生成人员（员工 ${TOTAL_EMPLOYEES} + 家属）…`);
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

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
