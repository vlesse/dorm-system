/**
 * 三语支持：中文 / 印尼语 / 英文。
 * 宿管队伍里有印尼籍，界面必须能切。新增文案往这里加一行即可。
 */
import { createContext, useContext } from 'react';

export type Lang = 'zh' | 'id' | 'en';

type Dict = Record<string, [string, string, string]>; // [zh, id, en]

const D: Dict = {
  appName: ['宿舍管理系统', 'Sistem Manajemen Asrama', 'Dormitory Management'],

  // —— 导航 ——
  grp_overview: ['总览', 'Ringkasan', 'Overview'],
  grp_space: ['空间与人员', 'Ruang & Penghuni', 'Space & People'],
  grp_ops: ['日常运营', 'Operasional', 'Operations'],
  grp_report: ['报表与合规', 'Laporan & Kepatuhan', 'Reports & Compliance'],
  grp_system: ['系统', 'Sistem', 'System'],
  nav_dashboard: ['总览', 'Ringkasan', 'Overview'],
  nav_bedmap: ['床位图', 'Peta Tempat Tidur', 'Bed Map'],
  nav_persons: ['人员', 'Karyawan', 'People'],
  nav_families: ['夫妻与家属', 'Pasangan & Keluarga', 'Couples & Family'],
  nav_requests: ['申请审批', 'Persetujuan', 'Requests'],
  nav_workorders: ['报修工单', 'Perbaikan', 'Work Orders'],
  nav_violations: ['违规记录', 'Pelanggaran', 'Violations'],
  nav_visitors: ['访客登记', 'Tamu', 'Visitors'],
  nav_inspections: ['查寝与检查', 'Inspeksi', 'Inspections'],
  nav_roster: ['在住花名册', 'Daftar Penghuni', 'Roster'],
  nav_evacuation: ['消防疏散', 'Evakuasi', 'Evacuation'],
  nav_alerts: ['待办告警', 'Peringatan', 'Alerts'],
  nav_settings: ['设置', 'Pengaturan', 'Settings'],

  // —— 通用 ——
  totalBeds: ['总床位', 'Total Tempat Tidur', 'Total Beds'],
  usableBeds: ['可用床位', 'Tempat Tidur Tersedia', 'Usable Beds'],
  occupied: ['在住', 'Dihuni', 'Occupied'],
  held: ['休假保留', 'Ditahan (Cuti)', 'Held (Leave)'],
  free: ['空床', 'Kosong', 'Vacant'],
  reserved: ['待入住', 'Dipesan', 'Reserved'],
  maintenance: ['维修/封锁', 'Perbaikan/Terkunci', 'Out of Service'],
  disabledBeds: ['降标撤除', 'Dinonaktifkan', 'Removed (De-rated)'],
  occupancyRate: ['入住率', 'Tingkat Hunian', 'Occupancy Rate'],
  people: ['人员总数', 'Total Orang', 'Total People'],
  employees: ['员工', 'Karyawan', 'Employees'],
  dependents: ['家属随迁', 'Keluarga', 'Dependents'],
  housed: ['已安排住宿', 'Sudah Ditempatkan', 'Housed'],
  unhoused: ['未安排住宿', 'Belum Ditempatkan', 'Unhoused'],

  byBuilding: ['按楼栋', 'Per Gedung', 'By Building'],
  byNationality: ['按国籍', 'Per Kewarganegaraan', 'By Nationality'],
  byDepartment: ['按部门', 'Per Departemen', 'By Department'],
  byRoomType: ['按房型', 'Per Tipe Kamar', 'By Room Type'],
  byContractor: ['按雇佣主体', 'Per Kontraktor', 'By Employer'],
  byPersonType: ['按人员类型', 'Per Jenis Penghuni', 'By Person Type'],

  building: ['楼栋', 'Gedung', 'Building'],
  floor: ['楼层', 'Lantai', 'Floor'],
  room: ['房间', 'Kamar', 'Room'],
  bed: ['床位', 'Tempat Tidur', 'Bed'],
  roomType: ['房型', 'Tipe Kamar', 'Room Type'],
  status: ['状态', 'Status', 'Status'],
  capacity: ['核定人数', 'Kapasitas Resmi', 'Approved Capacity'],
  nominalCapacity: ['房型标称', 'Kapasitas Nominal', 'Nominal Capacity'],
  derated: ['已降标', 'Diturunkan', 'De-rated'],
  deratedReason: ['降标原因', 'Alasan Penurunan', 'De-rating Reason'],
  adjustCapacity: ['调整核定人数', 'Ubah Kapasitas', 'Adjust Capacity'],
  functionRoom: ['功能房', 'Ruang Fungsional', 'Function Room'],
  elevator: ['电梯', 'Lift', 'Elevator'],
  facilities: ['设施', 'Fasilitas', 'Facilities'],
  assets: ['房间资产', 'Aset Kamar', 'Room Assets'],
  extraBed: ['加床', 'Tambah Ranjang', 'Extra Bed'],

  employeeNo: ['工号', 'No. Karyawan', 'Employee No.'],
  name: ['姓名', 'Nama', 'Name'],
  gender: ['性别', 'Jenis Kelamin', 'Gender'],
  male: ['男', 'Laki-laki', 'Male'],
  female: ['女', 'Perempuan', 'Female'],
  age: ['年龄', 'Usia', 'Age'],
  nationality: ['国籍', 'Kewarganegaraan', 'Nationality'],
  department: ['部门', 'Departemen', 'Department'],
  positionLevel: ['职级', 'Jenjang Jabatan', 'Position Level'],
  shift: ['班次', 'Sif', 'Shift'],
  contractor: ['雇佣主体', 'Pemberi Kerja', 'Employer'],
  religion: ['宗教信仰', 'Agama', 'Religion'],
  dietary: ['饮食禁忌', 'Aturan Makanan', 'Dietary Rule'],
  smoker: ['吸烟', 'Merokok', 'Smoker'],
  lowerBunkOnly: ['不能睡上铺', 'Tidak Bisa Ranjang Atas', 'Lower Bunk Only'],
  needsGroundFloor: ['需低楼层', 'Perlu Lantai Bawah', 'Needs Low Floor'],
  languages: ['语言', 'Bahasa', 'Languages'],
  idNumber: ['证件号', 'No. Identitas', 'ID Number'],
  idExpiry: ['证件到期', 'Masa Berlaku', 'ID Expiry'],
  passportHeld: ['护照代管', 'Paspor Dititipkan', 'Passport Held'],
  phone: ['电话', 'Telepon', 'Phone'],
  emergencyContact: ['紧急联系人', 'Kontak Darurat', 'Emergency Contact'],
  personType: ['人员类型', 'Jenis Penghuni', 'Person Type'],
  accommodation: ['住宿', 'Akomodasi', 'Accommodation'],
  checkInAt: ['入住日期', 'Tgl. Masuk', 'Check-in Date'],
  employmentStatus: ['在职状态', 'Status Kerja', 'Employment'],
  leaveCycle: ['休假周期', 'Siklus Cuti', 'Leave Cycle'],
  nextLeave: ['下次休假', 'Cuti Berikutnya', 'Next Leave'],

  assign: ['分配床位', 'Tetapkan Kamar', 'Assign Bed'],
  transfer: ['调宿', 'Pindah Kamar', 'Transfer'],
  checkout: ['退宿', 'Check-out', 'Check-out'],
  hold: ['休假保留', 'Tahan (Cuti)', 'Hold for Leave'],
  resume: ['返岗恢复', 'Kembali Bertugas', 'Resume'],
  history: ['住宿历史', 'Riwayat Hunian', 'History'],
  search: ['搜索姓名 / 工号 / 证件号', 'Cari nama / no. karyawan', 'Search name / employee no.'],
  export: ['导出 CSV', 'Ekspor CSV', 'Export CSV'],
  all: ['全部', 'Semua', 'All'],
  confirm: ['确认', 'Konfirmasi', 'Confirm'],
  cancel: ['取消', 'Batal', 'Cancel'],
  save: ['保存', 'Simpan', 'Save'],
  create: ['新建', 'Buat', 'New'],
  detail: ['详情', 'Detail', 'Detail'],
  recommended: ['推荐床位', 'Rekomendasi', 'Recommended'],
  warnings: ['排宿提醒', 'Peringatan Penempatan', 'Placement Warnings'],
  none: ['无', 'Tidak Ada', 'None'],

  // —— 夫妻 / 家属 ——
  couple: ['夫妻房', 'Kamar Suami Istri', 'Couple Room'],
  spouse: ['配偶', 'Pasangan', 'Spouse'],
  child: ['子女', 'Anak', 'Child'],
  verified: ['已核验', 'Terverifikasi', 'Verified'],
  unverified: ['未核验', 'Belum Verifikasi', 'Unverified'],
  hostPerson: ['挂靠员工', 'Karyawan Penanggung', 'Host Employee'],
  assignCouple: ['整户安排夫妻房', 'Tempatkan Pasangan', 'Assign Couple Room'],
  coupleHint: [
    '夫妻房只能住已登记且已核验（结婚证）的配偶。系统会一次安排两人，不用分两步。',
    'Kamar pasangan hanya untuk suami istri terverifikasi. Sistem menempatkan keduanya sekaligus.',
    'Couple rooms require a verified spouse relationship; the system places both people at once.',
  ],

  // —— 运营 ——
  workOrder: ['报修工单', 'Perbaikan', 'Work Order'],
  category: ['类别', 'Kategori', 'Category'],
  priority: ['优先级', 'Prioritas', 'Priority'],
  location: ['位置', 'Lokasi', 'Location'],
  reporter: ['报修人', 'Pelapor', 'Reporter'],
  assignedTo: ['处理人', 'Ditugaskan Ke', 'Assigned To'],
  sla: ['时限', 'Batas Waktu', 'SLA'],
  overdue: ['已超时', 'Terlambat', 'Overdue'],
  cost: ['费用', 'Biaya', 'Cost'],
  blocksOccupancy: ['影响住宿', 'Blokir Hunian', 'Blocks Occupancy'],
  violation: ['违规', 'Pelanggaran', 'Violation'],
  severity: ['严重程度', 'Tingkat', 'Severity'],
  points: ['扣分', 'Poin', 'Points'],
  fine: ['罚款', 'Denda', 'Fine'],
  action: ['处理方式', 'Tindakan', 'Action'],
  ranking: ['违规积分排行', 'Peringkat Pelanggaran', 'Violation Ranking'],
  visitor: ['访客', 'Tamu', 'Visitor'],
  overnight: ['留宿', 'Menginap', 'Overnight'],
  purpose: ['来访事由', 'Tujuan', 'Purpose'],
  expectedOut: ['预计离开', 'Perkiraan Keluar', 'Expected Out'],
  inspection: ['检查', 'Inspeksi', 'Inspection'],
  rollCall: ['夜间查寝', 'Absensi Malam', 'Night Roll Call'],
  hygiene: ['卫生检查', 'Inspeksi Kebersihan', 'Hygiene Check'],
  safety: ['安全检查', 'Inspeksi K3', 'Safety Check'],
  present: ['在位', 'Hadir', 'Present'],
  absent: ['未归', 'Tidak Hadir', 'Absent'],
  score: ['评分', 'Nilai', 'Score'],
  issues: ['发现问题', 'Temuan', 'Issues'],
  request: ['申请', 'Permohonan', 'Request'],
  approve: ['批准', 'Setujui', 'Approve'],
  reject: ['驳回', 'Tolak', 'Reject'],
  pending: ['待审批', 'Menunggu', 'Pending'],
  reason: ['事由', 'Alasan', 'Reason'],
  items: ['物品', 'Barang', 'Items'],
  deposit: ['押金', 'Deposit', 'Deposit'],
  returnItem: ['归还', 'Kembalikan', 'Return'],
  notReturned: ['未归还', 'Belum Dikembalikan', 'Not Returned'],
  compensation: ['赔偿', 'Ganti Rugi', 'Compensation'],
  announcement: ['公告', 'Pengumuman', 'Announcement'],

  // —— 报表 ——
  evacuation: ['消防疏散清单', 'Daftar Evakuasi', 'Evacuation List'],
  evacuation_hint: [
    '按楼栋 → 楼层列出此刻在住的人。火灾、地震、检查时按这份清点，需要协助的人单独标出。',
    'Daftar penghuni saat ini per gedung dan lantai untuk evakuasi darurat.',
    'Current residents by building and floor, for emergency roll-call.',
  ],
  needsHelp: ['需协助疏散', 'Perlu Bantuan', 'Needs Assistance'],
  contacts: ['同住接触者', 'Kontak Serumah', 'Close Contacts'],
  contactTrace: ['密接排查', 'Pelacakan Kontak', 'Contact Tracing'],

  // —— 告警 ——
  alert_resigned: ['离职未退宿', 'Resign Belum Check-out', 'Resigned but Still Housed'],
  alert_leave: ['休假即将到期', 'Cuti Jatuh Tempo', 'Leave Due Soon'],
  alert_reserved: ['已分配超期未入住', 'Dipesan Belum Masuk', 'Reserved Not Checked In'],
  alert_mismatch: ['状态口径不一致', 'Status Tidak Sinkron', 'Status Mismatch'],
  alert_idExpiring: ['证件即将到期', 'Dokumen Akan Kedaluwarsa', 'ID Expiring Soon'],
  alert_woOverdue: ['报修超时未完成', 'Perbaikan Terlambat', 'Work Orders Overdue'],
  alert_violation: ['违规积分超限', 'Poin Pelanggaran Berlebih', 'Violation Points Over Limit'],
  alert_overCapacity: ['房间超住', 'Kamar Kelebihan Penghuni', 'Rooms Over Capacity'],
  alert_funcOccupied: ['功能房被占住', 'Ruang Fungsional Dihuni', 'Function Room Occupied'],
  alert_deratedMismatch: ['降标与床位不一致', 'Kapasitas Tidak Sinkron', 'De-rating Mismatch'],
  alert_couple: ['夫妻房异常', 'Anomali Kamar Pasangan', 'Couple Room Anomalies'],
  alert_dependentApart: ['家属未与员工同房', 'Keluarga Terpisah', 'Dependents Separated'],
  alert_visitorOverstay: ['访客超期未离开', 'Tamu Melebihi Waktu', 'Visitor Overstay'],
  alert_pendingRequests: ['申请待审批', 'Permohonan Menunggu', 'Pending Requests'],
  alert_itemsNotReturned: ['物品未归还', 'Barang Belum Kembali', 'Items Not Returned'],

  // —— 设置 ——
  rules: ['排宿规则', 'Aturan Penempatan', 'Placement Rules'],
  rules_hint: [
    '每条规则可设为：关闭 / 仅提醒 / 强制拦截。改完立即生效，不用改代码。强制拦截连管理员也越不过去。',
    'Setiap aturan: Nonaktif / Peringatan / Wajib. Berlaku langsung.',
    'Each rule: Off / Warn / Enforce. Takes effect immediately.',
  ],
  mode_OFF: ['关闭', 'Nonaktif', 'Off'],
  mode_SOFT: ['仅提醒', 'Peringatan', 'Warn'],
  mode_HARD: ['强制拦截', 'Wajib', 'Enforce'],
  zoning: ['国籍分区', 'Zonasi Kewarganegaraan', 'Nationality Zoning'],
  zoning_hint: [
    '楼栋可设默认国籍，楼层可单独覆盖 —— 支持「一二层印尼籍、三层中方」这种混住。留空 = 不限。',
    'Gedung punya default, lantai bisa menimpa. Kosong = bebas.',
    'Buildings set a default; floors can override. Blank = unrestricted.',
  ],
  thresholds: ['阈值设置', 'Ambang Batas', 'Thresholds'],
  devices: ['设备点位', 'Perangkat', 'Devices'],
  devices_hint: [
    '楼道摄像头点位已登记，一期不接码流。二期接入视频网关后，这里可直接点开实时画面。',
    'Titik kamera sudah terdaftar, streaming pada fase 2.',
    'Camera points registered; streaming arrives in phase 2.',
  ],
  camera: ['摄像头', 'Kamera', 'Camera'],
  door: ['门禁', 'Akses Pintu', 'Access Door'],
  meter: ['电表', 'Meteran', 'Meter'],
  phase2: ['二期接入', 'Fase 2', 'Phase 2'],
  noBed: ['未安排床位', 'Belum Ada Kamar', 'No Bed Assigned'],
  empty: ['空', 'Kosong', 'Empty'],
  users: ['账号与权限', 'Akun & Hak Akses', 'Users & Roles'],
};

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'id', label: 'Bahasa' },
  { value: 'en', label: 'English' },
];

const IDX: Record<Lang, number> = { zh: 0, id: 1, en: 2 };

export const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: 'zh',
  setLang: () => {},
});

export function useT() {
  const { lang } = useContext(LangContext);
  return (key: string): string => {
    const row = D[key];
    return row ? row[IDX[lang]] : String(key);
  };
}

export function useLang() {
  return useContext(LangContext);
}

/** 字典项按当前语言取名 */
export function useDictName() {
  const { lang } = useContext(LangContext);
  return (item: { nameZh?: string; nameId?: string; nameEn?: string } | null | undefined) => {
    if (!item) return '';
    return lang === 'zh' ? item.nameZh ?? '' : lang === 'id' ? item.nameId ?? '' : item.nameEn ?? '';
  };
}
