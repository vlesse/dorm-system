import { createContext, useContext } from 'react';

export interface Meta {
  site: { id: number; code: string; name: string; address?: string } | null;
  nationalities: any[];
  departments: any[];
  positionLevels: any[];
  shifts: any[];
  religions: any[];
  contractors: any[];
  roomTypes: any[];
  itemTypes: any[];
  violationTypes: any[];
  workOrderCategories: any[];
  roles: any[];
  users: any[];
  settings: Record<string, any>;
  defaultRules: Record<string, string>;
  ruleMeta: Record<string, { zh: string; id: string; en: string; hint: string }>;
  bedStatuses: string[];
  roomStatuses: string[];
  employmentStatuses: string[];
  personTypes: string[];
  workOrderStatuses: string[];
  priorities: string[];
  severities: string[];
  requestTypes: string[];
  inspectionTypes: string[];
  relationshipTypes: string[];
}

export const MetaContext = createContext<Meta>(null as unknown as Meta);
export const useMeta = () => useContext(MetaContext);

export const BED_STATUS_COLOR: Record<string, string> = {
  FREE: '#f5f5f5',
  RESERVED: '#faad14',
  OCCUPIED: '#1677ff',
  HELD: '#722ed1',
  MAINTENANCE: '#ff7875',
  LOCKED: '#8c8c8c',
  DISABLED: '#bfbfbf',
};

type L3 = [string, string, string];
const M = <T extends Record<string, L3>>(o: T) => o;

export const BED_STATUS_LABEL = M({
  FREE: ['空床', 'Kosong', 'Vacant'],
  RESERVED: ['待入住', 'Dipesan', 'Reserved'],
  OCCUPIED: ['在住', 'Dihuni', 'Occupied'],
  HELD: ['休假保留', 'Ditahan', 'Held'],
  MAINTENANCE: ['维修', 'Perbaikan', 'Maintenance'],
  LOCKED: ['封锁', 'Terkunci', 'Locked'],
  DISABLED: ['降标撤除', 'Dinonaktifkan', 'Removed'],
});

export const ROOM_STATUS_LABEL = M({
  AVAILABLE: ['可用', 'Tersedia', 'Available'],
  MAINTENANCE: ['维修中', 'Perbaikan', 'Maintenance'],
  QUARANTINE: ['隔离', 'Isolasi', 'Quarantine'],
  LOCKED: ['封锁', 'Terkunci', 'Locked'],
  CLEANING: ['待清洁', 'Dibersihkan', 'Cleaning'],
});

export const EMPLOYMENT_LABEL = M({
  ACTIVE: ['在职', 'Aktif', 'Active'],
  ON_LEAVE: ['休假中', 'Cuti', 'On Leave'],
  BUSINESS_TRIP: ['出差', 'Dinas Luar', 'Business Trip'],
  HOSPITALIZED: ['住院', 'Dirawat', 'Hospitalized'],
  RESIGNED: ['已离职', 'Resign', 'Resigned'],
});

export const OCC_STATUS_LABEL = M({
  ACTIVE: ['在住', 'Dihuni', 'Active'],
  HELD: ['休假保留', 'Ditahan', 'Held'],
  RESERVED: ['待入住', 'Dipesan', 'Reserved'],
  ENDED: ['已退宿', 'Selesai', 'Ended'],
});

export const PERSON_TYPE_LABEL = M({
  EMPLOYEE: ['员工', 'Karyawan', 'Employee'],
  DEPENDENT: ['家属随迁', 'Keluarga', 'Dependent'],
  VISITOR: ['长期访客', 'Tamu', 'Visitor'],
  INTERN: ['实习生', 'Magang', 'Intern'],
});

export const WO_STATUS_LABEL = M({
  NEW: ['待派工', 'Baru', 'New'],
  ASSIGNED: ['已派工', 'Ditugaskan', 'Assigned'],
  IN_PROGRESS: ['处理中', 'Dikerjakan', 'In Progress'],
  DONE: ['已完成', 'Selesai', 'Done'],
  CLOSED: ['已关闭', 'Ditutup', 'Closed'],
  REJECTED: ['已驳回', 'Ditolak', 'Rejected'],
});

export const PRIORITY_LABEL = M({
  LOW: ['低', 'Rendah', 'Low'],
  NORMAL: ['普通', 'Normal', 'Normal'],
  HIGH: ['高', 'Tinggi', 'High'],
  URGENT: ['紧急', 'Mendesak', 'Urgent'],
});

export const SEVERITY_LABEL = M({
  LOW: ['轻微', 'Ringan', 'Low'],
  MEDIUM: ['一般', 'Sedang', 'Medium'],
  HIGH: ['严重', 'Berat', 'High'],
  CRITICAL: ['重大', 'Kritis', 'Critical'],
});

export const VIOLATION_STATUS_LABEL = M({
  OPEN: ['待处理', 'Terbuka', 'Open'],
  HANDLED: ['已处理', 'Ditangani', 'Handled'],
  APPEALED: ['申诉中', 'Banding', 'Appealed'],
  CLOSED: ['已关闭', 'Ditutup', 'Closed'],
});

export const VISITOR_STATUS_LABEL = M({
  PENDING: ['待审批', 'Menunggu', 'Pending'],
  APPROVED: ['已批准', 'Disetujui', 'Approved'],
  REJECTED: ['已驳回', 'Ditolak', 'Rejected'],
  IN: ['在园', 'Di Dalam', 'On Site'],
  OUT: ['已离开', 'Keluar', 'Left'],
});

export const REQUEST_TYPE_LABEL = M({
  CHECKIN: ['入住申请', 'Permohonan Masuk', 'Check-in'],
  TRANSFER: ['调宿申请', 'Pindah Kamar', 'Transfer'],
  CHECKOUT: ['退宿申请', 'Check-out', 'Check-out'],
  COUPLE_ROOM: ['夫妻房申请', 'Kamar Pasangan', 'Couple Room'],
  VISITOR_OVERNIGHT: ['访客留宿', 'Tamu Menginap', 'Visitor Overnight'],
  EXTRA_BED: ['加床申请', 'Tambah Ranjang', 'Extra Bed'],
});

export const REQUEST_STATUS_LABEL = M({
  PENDING: ['待审批', 'Menunggu', 'Pending'],
  APPROVED: ['已批准', 'Disetujui', 'Approved'],
  REJECTED: ['已驳回', 'Ditolak', 'Rejected'],
  CANCELLED: ['已撤销', 'Dibatalkan', 'Cancelled'],
  DONE: ['已执行', 'Selesai', 'Done'],
});

export const INSPECTION_TYPE_LABEL = M({
  NIGHT_ROLL_CALL: ['夜间查寝', 'Absensi Malam', 'Night Roll Call'],
  HYGIENE: ['卫生检查', 'Inspeksi Kebersihan', 'Hygiene Check'],
  SAFETY: ['安全检查', 'Inspeksi K3', 'Safety Check'],
});

export const REL_TYPE_LABEL = M({
  SPOUSE: ['配偶', 'Pasangan', 'Spouse'],
  CHILD: ['子女', 'Anak', 'Child'],
  PARENT: ['父母', 'Orang Tua', 'Parent'],
  SIBLING: ['兄弟姐妹', 'Saudara', 'Sibling'],
  OTHER: ['其他', 'Lainnya', 'Other'],
});

export const BED_POSITION_LABEL = M({
  UPPER: ['上铺', 'Ranjang Atas', 'Upper'],
  LOWER: ['下铺', 'Ranjang Bawah', 'Lower'],
  SINGLE: ['单床', 'Ranjang Tunggal', 'Single'],
  DOUBLE: ['双人床', 'Ranjang Ganda', 'Double'],
});

const IDX = { zh: 0, id: 1, en: 2 } as const;
export function labelOf(
  map: Record<string, L3>,
  key: string,
  lang: 'zh' | 'id' | 'en'
) {
  return map[key]?.[IDX[lang]] ?? key;
}

export const PRIORITY_COLOR: Record<string, string> = {
  LOW: 'default', NORMAL: 'blue', HIGH: 'orange', URGENT: 'red',
};
export const SEVERITY_COLOR: Record<string, string> = {
  LOW: 'default', MEDIUM: 'gold', HIGH: 'orange', CRITICAL: 'red',
};
export const WO_STATUS_COLOR: Record<string, string> = {
  NEW: 'red', ASSIGNED: 'orange', IN_PROGRESS: 'blue', DONE: 'green', CLOSED: 'default', REJECTED: 'default',
};
