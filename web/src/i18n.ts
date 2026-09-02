/**
 * 三语支持：中文 / 印尼语 / 英文。
 * 宿管队伍里有印尼籍，界面必须能切。新增文案往这里加一行即可。
 */
import { createContext, useContext } from 'react';

export type Lang = 'zh' | 'id' | 'en';

type Dict = Record<string, [string, string, string]>; // [zh, id, en]

const D: Dict = {
  appName: ['宿舍管理系统', 'Sistem Manajemen Asrama', 'Dormitory Management'],
  nav_dashboard: ['总览', 'Ringkasan', 'Overview'],
  nav_bedmap: ['床位图', 'Peta Tempat Tidur', 'Bed Map'],
  nav_persons: ['人员', 'Karyawan', 'People'],
  nav_roster: ['在住花名册', 'Daftar Penghuni', 'Roster'],
  nav_alerts: ['待办告警', 'Peringatan', 'Alerts'],
  nav_settings: ['设置', 'Pengaturan', 'Settings'],

  totalBeds: ['总床位', 'Total Tempat Tidur', 'Total Beds'],
  occupied: ['在住', 'Dihuni', 'Occupied'],
  held: ['休假保留', 'Ditahan (Cuti)', 'Held (Leave)'],
  free: ['空床', 'Kosong', 'Vacant'],
  reserved: ['待入住', 'Dipesan', 'Reserved'],
  maintenance: ['维修/封锁', 'Perbaikan/Terkunci', 'Out of Service'],
  occupancyRate: ['入住率', 'Tingkat Hunian', 'Occupancy Rate'],
  people: ['人员总数', 'Total Karyawan', 'Total People'],
  housed: ['已安排住宿', 'Sudah Ditempatkan', 'Housed'],
  unhoused: ['未安排住宿', 'Belum Ditempatkan', 'Unhoused'],

  byBuilding: ['按楼栋', 'Per Gedung', 'By Building'],
  byNationality: ['按国籍', 'Per Kewarganegaraan', 'By Nationality'],
  byDepartment: ['按部门', 'Per Departemen', 'By Department'],
  byRoomType: ['按房型', 'Per Tipe Kamar', 'By Room Type'],
  byContractor: ['按雇佣主体', 'Per Kontraktor', 'By Employer'],

  building: ['楼栋', 'Gedung', 'Building'],
  floor: ['楼层', 'Lantai', 'Floor'],
  room: ['房间', 'Kamar', 'Room'],
  bed: ['床位', 'Tempat Tidur', 'Bed'],
  roomType: ['房型', 'Tipe Kamar', 'Room Type'],
  status: ['状态', 'Status', 'Status'],
  capacity: ['核定人数', 'Kapasitas', 'Capacity'],

  employeeNo: ['工号', 'No. Karyawan', 'Employee No.'],
  name: ['姓名', 'Nama', 'Name'],
  gender: ['性别', 'Jenis Kelamin', 'Gender'],
  male: ['男', 'Laki-laki', 'Male'],
  female: ['女', 'Perempuan', 'Female'],
  nationality: ['国籍', 'Kewarganegaraan', 'Nationality'],
  department: ['部门', 'Departemen', 'Department'],
  positionLevel: ['职级', 'Jenjang Jabatan', 'Position Level'],
  shift: ['班次', 'Sif', 'Shift'],
  contractor: ['雇佣主体', 'Pemberi Kerja', 'Employer'],
  idNumber: ['证件号', 'No. Identitas', 'ID Number'],
  phone: ['电话', 'Telepon', 'Phone'],
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
  filter: ['筛选', 'Filter', 'Filter'],
  confirm: ['确认', 'Konfirmasi', 'Confirm'],
  cancel: ['取消', 'Batal', 'Cancel'],
  save: ['保存', 'Simpan', 'Save'],
  detail: ['详情', 'Detail', 'Detail'],
  recommended: ['推荐床位', 'Rekomendasi', 'Recommended'],
  warnings: ['排宿提醒', 'Peringatan Penempatan', 'Placement Warnings'],

  alert_resigned: ['离职未退宿', 'Sudah Resign Belum Check-out', 'Resigned but Still Housed'],
  alert_resigned_hint: [
    '人已离职但床位没释放 —— 这是宿舍数据失真的头号原因，必须清零',
    'Sudah resign tapi tempat tidur belum dilepas — penyebab utama data tidak akurat',
    'Resigned staff still holding beds — the top cause of inaccurate occupancy data',
  ],
  alert_leave: ['休假即将到期', 'Cuti Segera Jatuh Tempo', 'Leave Due Soon'],
  alert_reserved: ['已分配超期未入住', 'Dipesan Tapi Belum Masuk', 'Reserved but Not Checked In'],
  alert_mismatch: ['状态口径不一致', 'Status Tidak Sinkron', 'Status Mismatch'],

  rules: ['排宿规则', 'Aturan Penempatan', 'Placement Rules'],
  rules_hint: [
    '每条规则可设为：关闭 / 仅提醒 / 强制拦截。改完立即生效，不用改代码。',
    'Setiap aturan: Nonaktif / Peringatan / Wajib. Berlaku langsung.',
    'Each rule: Off / Warn / Enforce. Takes effect immediately.',
  ],
  rule_gender: ['男女不同房', 'Pisah Gender', 'Gender Separation'],
  rule_nationality: ['国籍符合区域归属', 'Sesuai Zona Kewarganegaraan', 'Nationality Zoning'],
  rule_positionRank: ['房型职级门槛', 'Syarat Jenjang Jabatan', 'Position Rank Requirement'],
  rule_shift: ['同房同班次', 'Sif Sama Sekamar', 'Same Shift per Room'],
  rule_department: ['同房同部门', 'Departemen Sama Sekamar', 'Same Department per Room'],
  rule_contractor: ['自有与承包商不混住', 'Pisah Karyawan & Kontraktor', 'Separate Contractor Staff'],
  rule_capacity: ['不得超住', 'Tidak Melebihi Kapasitas', 'Do Not Exceed Capacity'],
  rule_roomStatus: ['房间须可用', 'Kamar Harus Tersedia', 'Room Must Be Available'],
  mode_OFF: ['关闭', 'Nonaktif', 'Off'],
  mode_SOFT: ['仅提醒', 'Peringatan', 'Warn'],
  mode_HARD: ['强制拦截', 'Wajib', 'Enforce'],

  zoning: ['国籍分区', 'Zonasi Kewarganegaraan', 'Nationality Zoning'],
  zoning_hint: [
    '楼栋可设默认国籍，楼层可单独覆盖 —— 支持「一二层印尼籍、三层中方」这种混住。留空 = 不限。',
    'Gedung punya default, lantai bisa menimpa — mendukung campuran per lantai. Kosong = bebas.',
    'Buildings set a default; floors can override — supports mixed occupancy per floor. Blank = unrestricted.',
  ],
  devices: ['设备点位', 'Perangkat', 'Devices'],
  devices_hint: [
    '楼道摄像头点位已登记，一期不接码流。二期接入视频网关后，这里可直接点开实时画面。',
    'Titik kamera sudah terdaftar, belum ada streaming di fase 1.',
    'Camera points registered; streaming arrives in phase 2 via the video gateway.',
  ],
  camera: ['摄像头', 'Kamera', 'Camera'],
  door: ['门禁', 'Akses Pintu', 'Access Door'],
  meter: ['电表', 'Meteran', 'Meter'],
  phase2: ['二期接入', 'Fase 2', 'Phase 2'],
  noBed: ['未安排床位', 'Belum Ada Kamar', 'No Bed Assigned'],
  empty: ['空', 'Kosong', 'Empty'],
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
  return (key: keyof typeof D | string): string => {
    const row = D[key as keyof typeof D];
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
