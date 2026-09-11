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
  navComplaint: ['投诉', 'Pengaduan', 'Complaint'],

  // ---- 投诉 ----
  newComplaint: ['我要投诉', 'Buat Pengaduan', 'File a Complaint'],
  myComplaints: ['我的投诉', 'Pengaduan Saya', 'My Complaints'],
  noComplaints: ['你还没有提交过投诉', 'Belum ada pengaduan', 'No complaints yet'],
  cpType: ['投诉什么', 'Jenis Pengaduan', 'What is the issue'],
  cpWhere: ['在哪里', 'Di Mana', 'Where'],
  cpWhereRoom: ['某个房间', 'Kamar Tertentu', 'A specific room'],
  cpWherePublic: ['公共区域', 'Area Umum', 'Public area'],
  cpPickRoom: ['选房号', 'Pilih Kamar', 'Pick a room'],
  cpPickArea: ['哪个区域', 'Area Mana', 'Which area'],
  cpRoomHint: [
    '只要选房号就行，不用知道里面住的是谁',
    'Cukup pilih nomor kamar, tidak perlu tahu siapa penghuninya',
    'Just pick the room number — you do not need to know who lives there',
  ],
  cpWhen: ['什么时候发生的', 'Kapan Terjadi', 'When did it happen'],
  cpWhenHint: [
    '这个很重要 —— 宿管要按这个时间去现场看',
    'Ini penting — pengelola akan mengecek pada waktu tersebut',
    'This matters — the warden will check at that time',
  ],
  cpLastNight: ['昨晚', 'Tadi Malam', 'Last night'],
  cpToday: ['今天', 'Hari Ini', 'Today'],
  cpOther: ['其他时间', 'Waktu Lain', 'Other time'],
  cpDesc: ['具体说说', 'Jelaskan', 'Describe it'],
  cpDescHint: [
    '选填。说清楚点，宿管更好核实',
    'Opsional. Semakin jelas, semakin mudah diperiksa',
    'Optional. More detail helps the warden verify',
  ],
  cpAnonymous: ['匿名提交', 'Kirim Anonim', 'Submit anonymously'],
  cpAnonymousOn: [
    '被投诉的人和本楼宿管都看不到是谁投诉的。只有宿舍主管在需要联系你核实时才能查看，而且查看会被记录。',
    'Orang yang diadukan dan pengelola gedung tidak akan tahu siapa Anda. Hanya kepala asrama yang bisa melihat bila perlu menghubungi Anda, dan itu tercatat.',
    'Neither the reported party nor the building warden can see who you are. Only the dorm manager can look it up if they need to contact you, and that is logged.',
  ],
  cpAnonymousForced: [
    '这类投诉需要实名 —— 要联系你核实取证，匿名就查不下去了',
    'Pengaduan jenis ini harus dengan nama — kami perlu menghubungi Anda untuk verifikasi',
    'This type requires your name — we need to contact you to verify',
  ],
  cpPhoto: ['拍照 / 上传', 'Foto', 'Photo'],
  cpAudio: ['录一段', 'Rekam Suara', 'Record'],
  cpRecording: ['录音中…点一下停止', 'Merekam… ketuk untuk berhenti', 'Recording… tap to stop'],
  cpEvidenceHint: [
    '拍张照或录段声音最管用 —— 不用写字也能说明问题',
    'Foto atau rekaman paling membantu — tanpa perlu menulis',
    'A photo or recording helps most — no writing needed',
  ],
  cpWithdraw: ['撤回', 'Tarik', 'Withdraw'],
  cpWithdrawConfirm: ['确定撤回这条投诉？', 'Tarik pengaduan ini?', 'Withdraw this complaint?'],
  cpResult: ['处理结果', 'Hasil', 'Result'],
  cpRateHint: ['处理得怎么样？', 'Bagaimana penanganannya?', 'How was it handled?'],
  cpSubmitted: ['已提交，宿管会尽快核实', 'Terkirim, akan segera diperiksa', 'Submitted, it will be checked soon'],
  cpPrivacyTitle: ['投诉不会泄漏给被投诉的人', 'Pengaduan Anda dirahasiakan', 'Your complaint stays confidential'],

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

/** 投诉状态。NEW / CLOSED 在报修里是「待派工 / 已关闭」，这里是「待受理 / 已归档」，所以单独一份 */
const CP_STATUS: Record<string, L3> = {
  NEW: ['待受理', 'Menunggu Diterima', 'Pending'],
  ACCEPTED: ['已受理', 'Diterima', 'Accepted'],
  INVESTIGATING: ['核实中', 'Sedang Diperiksa', 'Investigating'],
  SUBSTANTIATED: ['已查实处理', 'Terbukti & Ditangani', 'Confirmed'],
  UNSUBSTANTIATED: ['核实后未认定', 'Tidak Terbukti', 'Not Confirmed'],
  DUPLICATE: ['与他人反映重复', 'Duplikat', 'Duplicate'],
  WITHDRAWN: ['已撤回', 'Ditarik', 'Withdrawn'],
  CLOSED: ['已归档', 'Selesai', 'Closed'],
};

const IDX = { zh: 0, id: 1, en: 2 } as const;

export function useSelfT() {
  const { lang } = useLang();
  const i = IDX[lang];
  return {
    t: (k: string) => D[k]?.[i] ?? k,
    reqType: (k: string) => REQ_TYPE[k]?.[i] ?? k,
    status: (k: string) => STATUS[k]?.[i] ?? k,
    cpStatus: (k: string) => CP_STATUS[k]?.[i] ?? k,
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
