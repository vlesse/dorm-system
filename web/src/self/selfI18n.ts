/**
 * 员工自助端的三语文案。
 * 单独一份，因为自助端面向工人，用词要比管理端更口语、更短。
 * 印尼籍员工是主要用户，Bahasa 必须完整。
 */
import { useLang } from '../i18n';

type L3 = [string, string, string]; // zh, id, en

const D: Record<string, L3> = {
  appName: ['宿舍服务', 'Layanan Asrama', 'Dorm Services'],
  login: ['登录', 'Masuk', 'Sign in'],
  employeeNo: ['工号', 'No. Karyawan', 'Employee No.'],
  employeeNoHint: ['请输入你的工号', 'Masukkan nomor karyawan Anda', 'Enter your employee number'],
  getCode: ['获取验证码', 'Kirim Kode', 'Get Code'],
  code: ['验证码', 'Kode Verifikasi', 'Verification Code'],
  codeSentTo: ['验证码已发送至', 'Kode dikirim ke', 'Code sent to'],
  resend: ['重新获取', 'Kirim Ulang', 'Resend'],
  loginHint: [
    '不用记密码 —— 输工号收验证码就能进。也可以用企业微信 / 钉钉扫码。',
    'Tidak perlu kata sandi — masukkan nomor karyawan dan terima kode.',
    'No password needed — enter your employee number and receive a code.',
  ],

  navHome: ['我的住宿', 'Kamar Saya', 'My Room'],
  navRepair: ['报修', 'Perbaikan', 'Repairs'],
  navRequest: ['申请', 'Permohonan', 'Requests'],
  navMe: ['我的', 'Saya', 'Me'],

  myRoom: ['我的住宿', 'Kamar Saya', 'My Room'],
  building: ['楼栋', 'Gedung', 'Building'],
  floor: ['楼层', 'Lantai', 'Floor'],
  room: ['房间', 'Kamar', 'Room'],
  bed: ['床位', 'Tempat Tidur', 'Bed'],
  roomType: ['房型', 'Tipe Kamar', 'Room Type'],
  checkInAt: ['入住日期', 'Tgl. Masuk', 'Check-in'],
  roommates: ['室友', 'Teman Sekamar', 'Roommates'],
  noRoom: ['你还没有安排住宿，请联系宿管', 'Anda belum ditempatkan, hubungi pengelola', 'No room assigned yet, contact the warden'],
  facilities: ['房间设施', 'Fasilitas Kamar', 'Room Facilities'],
  ac: ['空调', 'AC', 'Air Con'],
  bathroom: ['独立卫浴', 'Kamar Mandi Dalam', 'Private Bath'],
  waterHeater: ['热水器', 'Pemanas Air', 'Water Heater'],
  balcony: ['阳台', 'Balkon', 'Balcony'],

  reportRepair: ['我要报修', 'Lapor Perbaikan', 'Report a Repair'],
  repairCategory: ['报修类别', 'Kategori', 'Category'],
  repairTitle: ['什么问题', 'Masalah Apa', 'What is wrong'],
  repairTitleHint: ['一句话说清楚，如「空调不制冷」', 'Contoh: AC tidak dingin', 'e.g. Air con not cooling'],
  repairDesc: ['补充说明', 'Keterangan Tambahan', 'More Details'],
  submit: ['提交', 'Kirim', 'Submit'],
  myRepairs: ['我的报修', 'Perbaikan Saya', 'My Repairs'],
  noRepairs: ['还没有报修记录', 'Belum ada laporan', 'No repair records yet'],
  dueIn: ['承诺时限', 'Batas Waktu', 'Due within'],
  hours: ['小时', 'jam', 'hours'],
  rate: ['评价', 'Beri Nilai', 'Rate'],
  rated: ['已评价', 'Sudah Dinilai', 'Rated'],

  myRequests: ['我的申请', 'Permohonan Saya', 'My Requests'],
  newRequest: ['提交申请', 'Ajukan Permohonan', 'New Request'],
  requestType: ['申请类型', 'Jenis Permohonan', 'Request Type'],
  reason: ['申请事由', 'Alasan', 'Reason'],
  reasonHint: ['写清楚原因，宿管会据此审批', 'Jelaskan alasannya', 'Explain your reason'],
  noRequests: ['还没有申请记录', 'Belum ada permohonan', 'No requests yet'],
  cancel: ['撤销', 'Batalkan', 'Cancel'],
  cancelConfirm: ['确定撤销这条申请？', 'Batalkan permohonan ini?', 'Cancel this request?'],

  notifications: ['通知', 'Notifikasi', 'Notifications'],
  announcements: ['公告', 'Pengumuman', 'Announcements'],
  myItems: ['领用物品', 'Barang Saya', 'My Items'],
  deposit: ['押金', 'Deposit', 'Deposit'],
  myViolations: ['违规记录', 'Pelanggaran', 'Violations'],
  points: ['扣分', 'Poin', 'Points'],
  noViolations: ['没有违规记录', 'Tidak ada pelanggaran', 'No violations'],
  logout: ['退出登录', 'Keluar', 'Sign out'],
  nextLeave: ['下次休假', 'Cuti Berikutnya', 'Next Leave'],
  idExpiry: ['证件到期', 'Masa Berlaku Dokumen', 'ID Expiry'],
  daysLeft: ['天后', 'hari lagi', 'days left'],
  expired: ['已过期', 'Kedaluwarsa', 'Expired'],
  returned: ['已归还', 'Dikembalikan', 'Returned'],
  notReturned: ['未归还', 'Belum Dikembalikan', 'Not returned'],

  scanTitle: ['房间信息', 'Info Kamar', 'Room Info'],
  scanMine: ['这是你住的房间', 'Ini kamar Anda', 'This is your room'],
  scanNotMine: ['这不是你住的房间', 'Ini bukan kamar Anda', 'This is not your room'],
  openWorkOrders: ['该房间在办工单', 'Perbaikan berjalan', 'Open work orders'],
  loading: ['加载中…', 'Memuat…', 'Loading…'],
  success: ['提交成功', 'Berhasil dikirim', 'Submitted'],
};

const REQ_TYPE: Record<string, L3> = {
  TRANSFER: ['调换房间', 'Pindah Kamar', 'Room Transfer'],
  CHECKOUT: ['退宿', 'Check-out', 'Check-out'],
  COUPLE_ROOM: ['申请夫妻房', 'Kamar Suami Istri', 'Couple Room'],
  VISITOR_OVERNIGHT: ['访客留宿', 'Tamu Menginap', 'Visitor Overnight'],
  EXTRA_BED: ['申请加床', 'Tambah Ranjang', 'Extra Bed'],
};

const STATUS: Record<string, L3> = {
  PENDING: ['待审批', 'Menunggu', 'Pending'],
  APPROVED: ['已批准', 'Disetujui', 'Approved'],
  REJECTED: ['已驳回', 'Ditolak', 'Rejected'],
  CANCELLED: ['已撤销', 'Dibatalkan', 'Cancelled'],
  DONE: ['已完成', 'Selesai', 'Done'],
  NEW: ['待派工', 'Menunggu', 'New'],
  ASSIGNED: ['已派工', 'Ditugaskan', 'Assigned'],
  IN_PROGRESS: ['维修中', 'Dikerjakan', 'In Progress'],
  CLOSED: ['已关闭', 'Ditutup', 'Closed'],
};

const IDX = { zh: 0, id: 1, en: 2 } as const;

export function useSelfT() {
  const { lang } = useLang();
  const i = IDX[lang];
  return {
    t: (k: string) => D[k]?.[i] ?? k,
    reqType: (k: string) => REQ_TYPE[k]?.[i] ?? k,
    status: (k: string) => STATUS[k]?.[i] ?? k,
    lang,
    /** 后端字典项按当前语言取名。兼容两种形状：{zh,id,en} 和 {nameZh,nameId,nameEn} */
    dict: (o: any) => {
      if (!o) return '';
      if (typeof o === 'string') return o;
      if (o.zh !== undefined) return (lang === 'zh' ? o.zh : lang === 'id' ? o.id : o.en) ?? o.zh ?? '';
      return (lang === 'zh' ? o.nameZh : lang === 'id' ? o.nameId ?? o.nameZh : o.nameEn ?? o.nameZh) ?? '';
    },
    /** 铺位：把「1 下铺」渲染成当前语言 */
    bed: (position: string, no: string) => {
      const L: Record<string, [string, string, string]> = {
        UPPER: ['上铺', 'Ranjang Atas', 'Upper Bunk'],
        LOWER: ['下铺', 'Ranjang Bawah', 'Lower Bunk'],
        SINGLE: ['床', 'Ranjang', 'Bed'],
        DOUBLE: ['双人床', 'Ranjang Ganda', 'Double Bed'],
      };
      const word = L[position]?.[i] ?? position;
      return no ? `${no} ${word}` : word;
    },
  };
}

export const REQUEST_TYPE_KEYS = Object.keys(REQ_TYPE);
