/**
 * 通用配置字典 —— **开通任何新客户都要跑这一份**。
 *
 * 这里只放「换一个园区也基本适用」的东西：国籍、职级、班次、宗教、房型 18 种、
 * 物品、违规类型、工单类别、角色权限、投诉类别、系统设置（含排宿规则）。
 *
 * 行业专属的部门（冶炼厂 / 焦化厂…）、具体的劳务分包商、以及楼栋结构，
 * 都不在这里——那些属于某个客户自己的数据，见 seed-imip.ts。
 *
 * 这份字典是**默认值**，不是死规矩：客户开通后可以在「系统 → 配置」里全部改。
 */
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_RULES } from '../src/services/rules.js';
import type { Dict } from './seed-lib.js';

export async function seedDict(prisma: PrismaClient) {
  await prisma.nationality.createMany({
    data: [
      { id: 'ID', nameZh: '印度尼西亚', nameEn: 'Indonesia', nameId: 'Indonesia', color: '#f5222d', sortOrder: 1 },
      { id: 'CN', nameZh: '中国', nameEn: 'China', nameId: 'Tiongkok', color: '#fa8c16', sortOrder: 2 },
      { id: 'KR', nameZh: '韩国', nameEn: 'South Korea', nameId: 'Korea Selatan', color: '#722ed1', sortOrder: 3 },
      { id: 'DE', nameZh: '德国', nameEn: 'Germany', nameId: 'Jerman', color: '#13c2c2', sortOrder: 4 },
      { id: 'VN', nameZh: '越南', nameEn: 'Vietnam', nameId: 'Vietnam', color: '#52c41a', sortOrder: 5 },
    ],
  });

  // 通用部门。行业专属的生产部门在各客户自己的数据里补（见 seed-imip.ts）
  await prisma.department.createMany({
    data: [
      ['EHS', '安全环保部', 'Safety & Environment', 'K3 & Lingkungan'],
      ['HR', '人力资源部', 'Human Resources', 'Sumber Daya Manusia'],
      ['ADMIN', '行政后勤部', 'Administration', 'Administrasi'],
      ['PROC', '采购部', 'Procurement', 'Pengadaan'],
      ['FIN', '财务部', 'Finance', 'Keuangan'],
      ['SEC', '保安部', 'Security', 'Keamanan'],
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

  // 只放「本公司自有员工」。具体的劳务分包商属于客户自己的数据
  await prisma.contractor.createMany({
    data: [
      { code: 'SELF', name: '本公司自有员工', isSelf: true },
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
    data: Object.entries(ROLES).map(([code, r]) => ({ code, ...r })),
  });

  // 投诉类别。routeTo 是这张表里最关键的字段：
  // 「投诉宿舍管理服务」必须走 MANAGER，绕开本楼宿管 ——
  // 否则针对宿管的投诉会落到被投诉人自己手上，既处理不了，还会暴露投诉人。
  await prisma.complaintType.createMany({
    data: [
      { code: 'NOISE', nameZh: '噪音扰民 / 深夜喧哗', nameEn: 'Noise & Late-night Disturbance', nameId: 'Kebisingan / Keributan Malam',
        slaHours: 12, allowAnonymous: true, routeTo: 'WARDEN', severity: 'MEDIUM', sortOrder: 1 },
      { code: 'HYGIENE', nameZh: '卫生 / 过道堆放杂物', nameEn: 'Hygiene & Blocked Corridor', nameId: 'Kebersihan / Barang di Koridor',
        slaHours: 24, allowAnonymous: true, routeTo: 'WARDEN', severity: 'LOW', sortOrder: 2 },
      { code: 'ALCOHOL', nameZh: '酗酒 / 聚众喧闹', nameEn: 'Drinking & Rowdy Gathering', nameId: 'Mabuk / Berkumpul Ribut',
        slaHours: 12, allowAnonymous: true, routeTo: 'WARDEN', severity: 'HIGH', sortOrder: 3 },
      { code: 'SAFETY', nameZh: '安全隐患（私拉电线 / 明火）', nameEn: 'Safety Hazard', nameId: 'Bahaya Keselamatan',
        // 安全类直达 EHS，不经宿管转手 —— 火灾等不起一层审批
        slaHours: 4, allowAnonymous: true, routeTo: 'EHS', severity: 'CRITICAL', sortOrder: 4 },
      { code: 'SMOKING', nameZh: '禁烟区吸烟', nameEn: 'Smoking in No-smoking Area', nameId: 'Merokok di Area Terlarang',
        slaHours: 24, allowAnonymous: true, routeTo: 'WARDEN', severity: 'MEDIUM', sortOrder: 5 },
      { code: 'GUEST', nameZh: '私自留宿外人', nameEn: 'Unauthorized Overnight Guest', nameId: 'Menginapkan Tamu Tanpa Izin',
        slaHours: 24, allowAnonymous: true, routeTo: 'WARDEN', severity: 'HIGH', sortOrder: 6 },
      { code: 'FACILITY', nameZh: '公共设施被占用 / 损坏', nameEn: 'Shared Facility Misuse', nameId: 'Fasilitas Bersama Disalahgunakan',
        slaHours: 48, allowAnonymous: true, routeTo: 'WARDEN', severity: 'LOW', sortOrder: 7 },
      { code: 'THEFT', nameZh: '财物丢失 / 被盗', nameEn: 'Theft or Lost Property', nameId: 'Kehilangan / Pencurian Barang',
        // 强制实名：要联系失主核实清单、取证、可能报警，匿名就查不下去
        slaHours: 8, allowAnonymous: false, routeTo: 'MANAGER', severity: 'HIGH', sortOrder: 8 },
      { code: 'CONFLICT', nameZh: '肢体冲突 / 恐吓威胁', nameEn: 'Physical Conflict or Threat', nameId: 'Perkelahian / Ancaman',
        // 同上，而且需要当事人愿意出面
        slaHours: 4, allowAnonymous: false, routeTo: 'MANAGER', severity: 'CRITICAL', sortOrder: 9 },
      { code: 'DISCRIMINATION', nameZh: '歧视 / 言语侮辱', nameEn: 'Discrimination or Verbal Abuse', nameId: 'Diskriminasi / Pelecehan Verbal',
        // 多国籍混住场景下真实存在，走主管而不是本楼宿管
        slaHours: 24, allowAnonymous: true, routeTo: 'MANAGER', severity: 'HIGH', sortOrder: 10 },
      { code: 'SERVICE', nameZh: '投诉宿舍管理服务', nameEn: 'Complaint about Dorm Management', nameId: 'Keluhan Layanan Pengelola',
        // 被投诉的可能就是本楼宿管本人，所以这条**必须**绕开 WARDEN
        slaHours: 24, allowAnonymous: true, routeTo: 'MANAGER', severity: 'MEDIUM', sortOrder: 11 },
      { code: 'OTHER', nameZh: '其他', nameEn: 'Other', nameId: 'Lainnya',
        slaHours: 48, allowAnonymous: true, routeTo: 'WARDEN', severity: 'LOW', sortOrder: 99 },
    ],
  });

  // 投诉类别 → 认定成立时默认转成的违规类型。认定弹窗会预填这一项，处理人可改可清空。
  // 财物丢失、肢体冲突、歧视、投诉宿管这些不是「违反宿舍规定」，不设默认，要开单由处理人自己选
  const vtIds = new Map((await prisma.violationType.findMany()).map((v) => [v.code, v.id]));
  for (const [ct, vt] of Object.entries(COMPLAINT_TO_VIOLATION)) {
    if (vtIds.has(vt)) await prisma.complaintType.updateMany({ where: { code: ct }, data: { violationTypeId: vtIds.get(vt) } });
  }

  await prisma.settingItem.createMany({
    data: [
      { key: 'allocation.rules', group: 'allocation', description: '排宿规则：OFF 关闭 / SOFT 提醒 / HARD 拦截', value: JSON.stringify(DEFAULT_RULES) },
      { key: 'leave.warningDays', group: 'leave', description: '休假到期提前提醒天数', value: '30' },
      { key: 'id.expiryWarningDays', group: 'compliance', description: '证件（护照 / KITAS）到期提前提醒天数', value: '90' },
      { key: 'leave.autoReleaseDays', group: 'leave', description: '休假超过多少天自动释放床位（0 = 一律保留）', value: '0' },
      { key: 'reserved.staleDays', group: 'allocation', description: '已分配多少天未入住算超期', value: '3' },
      { key: 'violation.pointsThreshold', group: 'violation', description: '违规累计扣分达到多少触发处理', value: '10' },
      { key: 'org.name', group: 'general', description: '组织名称（开通新客户后第一件要改的事）', value: JSON.stringify('') },
      { key: 'locale.default', group: 'general', description: '默认语言 zh / id / en', value: JSON.stringify('zh') },
      { key: 'complaint.dailyLimit', group: 'complaint', description: '同一人 24 小时内最多提交几条投诉（防刷）', value: '3' },
      { key: 'complaint.targetCooldownHours', group: 'complaint', description: '同一人对同一房间的投诉冷却小时数', value: '24' },
      { key: 'complaint.maxBacklogDays', group: 'complaint', description: '最多可投诉多少天以前发生的事', value: '14' },
      { key: 'complaint.relatedWindowDays', group: 'complaint', description: '判定「反映同一件事」的时间窗（天）', value: '3' },
      { key: 'complaint.repeatThreshold', group: 'complaint', description: '同一房间被多少个不同的人反映就告警', value: '3' },
      { key: 'complaint.hotRoomWindowDays', group: 'complaint', description: '重点房间统计窗口（天）', value: '30' },
      { key: 'video.gatewayUrl', group: 'video', description: '视频网关地址（后期接监控时填，如 http://10.0.0.9:1984）', value: JSON.stringify('') },
    ],
  });
}

/** 字典写完之后查出来备用，空间与演示数据模块都要用 */
export async function loadDict(prisma: PrismaClient): Promise<Dict> {
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
  return {
    depts, levels, shifts, contractors, religions,
    roomTypes, itemTypes, violationTypes, woCategories, roles,
    rtByCode, lvByCode, relByCode,
  };
}

/**
 * 角色与权限点 —— **唯一的一份**。
 * 以前这里是一套旧口径，seed-platform 再覆盖成新口径；结果 `db:seed:blank` 开通的空系统
 * 只跑这里、拿到的是旧口径（宿舍主管没有 space:all、宿管没有任何投诉权限）。
 *
 * 权限点 `模块:动作`，`*` 全部，`模块:*` 模块内全部。
 * 注意 complaint:identity 不随 `complaint:*` 下发，必须显式写（见 services/auth.ts EXPLICIT_ONLY）。
 */
export const ROLES: Record<string, { nameZh: string; nameEn: string; nameId: string; permissions: string }> = {
  ADMIN: { nameZh: '系统管理员', nameEn: 'System Admin', nameId: 'Admin Sistem', permissions: '*' },
  // 宿舍主管能揭示匿名投诉人（核实、回访需要），但每次都写审计
  DORM_MANAGER: {
    nameZh: '宿舍主管', nameEn: 'Dormitory Manager', nameId: 'Manajer Asrama',
    permissions: 'space:*,space:all,person:*,allocation:*,report:*,workorder:*,violation:*,inspection:*,visitor:*,request:*,item:*,complaint:*,complaint:identity,config:write,config:read,user:read,audit:read',
  },
  // 楼栋宿管：没有 space:all → 只看自己楼栋；能管房间 / 床位状态，改不了国籍分区、房型和核定人数
  // 投诉只给 read + write：没有 complaint:all 看不到「投诉宿管本人」那类，没有 complaint:identity 揭不开匿名
  WARDEN: {
    nameZh: '楼栋宿管', nameEn: 'Building Warden', nameId: 'Pengelola Gedung',
    permissions: 'space:read,space:room,person:read,allocation:*,workorder:*,violation:create,violation:read,inspection:*,visitor:*,request:read,item:*,complaint:read,complaint:write,report:read',
  },
  HR: {
    nameZh: '人力资源', nameEn: 'HR', nameId: 'SDM',
    permissions: 'person:*,report:read,space:read,space:all,request:read,complaint:read,complaint:all,complaint:identity,audit:read',
  },
  // EHS 处理安全类投诉，但不揭示匿名投诉人 —— 那是主管 / HR 的事
  EHS: {
    nameZh: '安全环保', nameEn: 'EHS', nameId: 'K3',
    permissions: 'report:read,space:read,space:all,person:read,violation:*,inspection:*,workorder:read,complaint:read,complaint:write,complaint:all',
  },
  VIEWER: { nameZh: '只读查看', nameEn: 'Viewer', nameId: 'Pembaca', permissions: 'report:read,space:read,space:all,person:read' },
};

export const COMPLAINT_TO_VIOLATION: Record<string, string> = {
  NOISE: 'NOISE', HYGIENE: 'HYGIENE', ALCOHOL: 'ALCOHOL', SMOKING: 'SMOKING',
  GUEST: 'OVERNIGHT_GUEST', FACILITY: 'DAMAGE',
};
