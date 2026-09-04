import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/services/auth.js';

/**
 * 平台层种子数据：账号密码、集成对接占位、通知模板、示例通知。
 * 由 seed.ts 在业务数据生成完之后调用。
 */
export async function seedPlatform(prisma: PrismaClient, buildingIds: Record<string, number>) {
  console.log('生成账号、集成占位与通知模板…');

  // ---------------------------------------------------------------- 角色权限点
  // 权限点写成 `模块:动作`，`*` 全部，`模块:*` 模块内全部
  const rolePerms: Record<string, string> = {
    ADMIN: '*',
    DORM_MANAGER: 'space:*,space:all,person:*,allocation:*,report:*,workorder:*,violation:*,inspection:*,visitor:*,request:*,item:*,config:write,config:read,user:read,audit:read',
    // 楼栋宿管：没有 space:all，因此只能看到自己楼栋的数据
    // 楼栋宿管可以管房间/床位状态（报修、封床），但改不了国籍分区和核定人数 —— 那是主管的事
    WARDEN: 'space:read,space:room,person:read,allocation:*,workorder:*,violation:create,violation:read,inspection:*,visitor:*,request:read,item:*,report:read',
    HR: 'person:*,report:read,space:read,space:all,request:read,audit:read',
    EHS: 'report:read,space:read,space:all,violation:*,inspection:*,workorder:read',
    VIEWER: 'report:read,space:read,space:all,person:read',
  };
  for (const [code, permissions] of Object.entries(rolePerms)) {
    await prisma.role.updateMany({ where: { code }, data: { permissions } });
  }

  // ---------------------------------------------------------------- 账号密码
  // 演示用初始密码，全部标记为「首次登录必须改密」
  const DEMO_PASSWORD = 'dorm@2026';
  const users = await prisma.user.findMany();
  for (const u of users) {
    await prisma.user.update({
      where: { id: u.id },
      data: {
        passwordHash: hashPassword(DEMO_PASSWORD),
        mustChangePassword: u.username !== 'admin',
        locale: u.username.startsWith('warden.c') || u.username.startsWith('warden.d') ? 'id' : 'zh',
      },
    });
  }

  // 给管理员和主管补一条本地身份绑定，示意 IdentityBinding 的用法
  const admin = users.find((u) => u.username === 'admin');
  if (admin) {
    await prisma.identityBinding.create({
      data: { provider: 'LOCAL', externalId: 'admin', userId: admin.id, displayName: '本地账号' },
    });
  }

  // ---------------------------------------------------------------- 集成对接占位
  await prisma.integration.createMany({
    data: [
      {
        provider: 'WECOM', nameZh: '企业微信', nameEn: 'WeCom', nameId: 'WeCom',
        capabilities: 'SSO,SYNC,NOTIFY,APPROVAL', sortOrder: 1,
        note: '中方员工主用。可做扫码登录、通讯录同步、应用消息推送、审批流对接。',
      },
      {
        provider: 'DINGTALK', nameZh: '钉钉', nameEn: 'DingTalk', nameId: 'DingTalk',
        capabilities: 'SSO,SYNC,NOTIFY,APPROVAL', sortOrder: 2,
        note: '与企业微信二选一，看总部用哪个。',
      },
      {
        provider: 'WHATSAPP', nameZh: 'WhatsApp Business', nameEn: 'WhatsApp Business', nameId: 'WhatsApp Business',
        capabilities: 'NOTIFY', sortOrder: 3,
        note: '印尼籍员工的主要触达渠道 —— 他们不用企业微信/钉钉。会话窗口外只能发已审核模板消息。',
      },
      {
        provider: 'LARK', nameZh: '飞书 / Lark', nameEn: 'Lark', nameId: 'Lark',
        capabilities: 'SSO,SYNC,NOTIFY,APPROVAL', sortOrder: 3,
        note: '与企业微信 / 钉钉同类，看总部用哪个。',
      },
      {
        provider: 'WEAVER_ECOLOGY', nameZh: '泛微 e-cology', nameEn: 'Weaver e-cology', nameId: 'Weaver e-cology',
        capabilities: 'SYNC,APPROVAL', sortOrder: 6,
        note: '国内中大型企业常见的 OA。可做花名册同步和调宿 / 夫妻房审批流对接。',
      },
      {
        provider: 'SEEYON', nameZh: '致远 A8 OA', nameEn: 'Seeyon A8', nameId: 'Seeyon A8',
        capabilities: 'SYNC,APPROVAL', sortOrder: 7,
        note: '与泛微同类，二选一。',
      },
      {
        provider: 'YONYOU_HR', nameZh: '用友 / 金蝶 HR', nameEn: 'Yonyou / Kingdee HR', nameId: 'Yonyou / Kingdee HR',
        capabilities: 'SYNC', sortOrder: 8,
        note: '花名册在 HR 系统而不在 OA 里时走这个。离职状态同步过来自动触发退宿。',
      },
      {
        provider: 'HIKVISION', nameZh: '海康威视 综合安防平台', nameEn: 'Hikvision iSecure / HikCentral', nameId: 'Hikvision iSecure',
        capabilities: 'VIDEO,ACCESS,SYNC', sortOrder: 9,
        note: '楼道监控与门禁。视频码流交独立网关，主应用只管「哪层楼有哪些摄像头」和权限。',
      },
      {
        provider: 'DAHUA', nameZh: '大华 DSS 平台', nameEn: 'Dahua DSS', nameId: 'Dahua DSS',
        capabilities: 'VIDEO,ACCESS', sortOrder: 10,
        note: '与海康同类，园区用哪家就配哪家。',
      },
      {
        provider: 'WEBHOOK', nameZh: '通用 Webhook', nameEn: 'Generic Webhook', nameId: 'Webhook Umum',
        capabilities: 'NOTIFY', sortOrder: 13,
        note: '兜底：任何自研 / 第三方系统，POST JSON 即可接收本系统的事件。',
      },
      {
        provider: 'AZURE_AD', nameZh: 'Microsoft Teams / Entra ID', nameEn: 'Microsoft Teams / Entra ID', nameId: 'Microsoft Teams / Entra ID',
        capabilities: 'SSO,SYNC,NOTIFY', sortOrder: 5,
        note: '有欧美合资方 / 用 M365 时才需要，通常只覆盖办公室人员。',
      },
      {
        provider: 'OA_HTTP', nameZh: '公司 OA / HR 接口', nameEn: 'Corporate OA / HR API', nameId: 'API OA / HR',
        capabilities: 'SYNC,APPROVAL', sortOrder: 4,
        note: '花名册的唯一来源。接上之后「离职未退宿」才能真正根治。',
      },
      {
        provider: 'LDAP', nameZh: 'LDAP / AD 域', nameEn: 'LDAP / Active Directory', nameId: 'LDAP / Active Directory',
        capabilities: 'SSO,SYNC', sortOrder: 11,
        note: '园区内网已有域控时可用。',
      },
      {
        provider: 'SMS', nameZh: '短信网关', nameEn: 'SMS Gateway', nameId: 'Gerbang SMS',
        capabilities: 'NOTIFY', sortOrder: 12,
        note: '兜底渠道：不装任何 App 的工人也能收到。',
      },
      {
        provider: 'SMTP', nameZh: '邮件 SMTP', nameEn: 'Email SMTP', nameId: 'Email SMTP',
        capabilities: 'NOTIFY', sortOrder: 14,
        note: '给管理层发日报 / 周报用。',
      },
    ],
  });

  // ---------------------------------------------------------------- 通知模板
  await prisma.notificationTemplate.createMany({
    data: [
      {
        code: 'SELF_OTP', nameZh: '自助端登录验证码',
        titleZh: '宿舍系统登录验证码', bodyZh: '验证码 {code}，{minutes} 分钟内有效。请勿转发给他人。',
        titleId: 'Kode verifikasi Sistem Asrama', bodyId: 'Kode {code}, berlaku {minutes} menit. Jangan bagikan.',
        titleEn: 'Dormitory system login code', bodyEn: 'Code {code}, valid {minutes} minutes. Do not share.',
        channels: 'SMS,WHATSAPP', audience: 'PERSON',
      },
      {
        code: 'REQUEST_SUBMITTED', nameZh: '员工提交申请通知',
        titleZh: '有新的住宿申请待审批', bodyZh: '{name} 提交了 {type} 申请（{code}）：{reason}',
        titleId: 'Permohonan baru menunggu persetujuan', bodyId: '{name} mengajukan {type} ({code}): {reason}',
        titleEn: 'New accommodation request', bodyEn: '{name} submitted a {type} request ({code}): {reason}',
        channels: 'IN_APP,WECOM', audience: 'ROLE',
      },
      {
        code: 'BED_ASSIGNED', nameZh: '床位分配通知',
        titleZh: '已为你安排住宿', bodyZh: '{name}，你的住宿已安排在 {room} {bed}，请携带证件到宿管室领取物品并办理入住。',
        titleId: 'Kamar Anda sudah ditentukan', bodyId: '{name}, kamar Anda: {room} {bed}. Silakan ke kantor pengelola untuk check-in.',
        titleEn: 'Accommodation assigned', bodyEn: '{name}, you are assigned to {room} {bed}. Please check in at the warden office.',
        channels: 'IN_APP,WECOM,WHATSAPP', audience: 'PERSON',
      },
      {
        code: 'TRANSFER_DONE', nameZh: '调宿完成通知',
        titleZh: '你的住宿已调整', bodyZh: '{name}，你的住宿已从 {from} 调整到 {to}，请于今日内完成搬迁。',
        titleId: 'Kamar Anda dipindahkan', bodyId: '{name}, kamar Anda pindah dari {from} ke {to}. Mohon pindah hari ini.',
        titleEn: 'Your room has changed', bodyEn: '{name}, you have been moved from {from} to {to}. Please relocate today.',
        channels: 'IN_APP,WECOM,WHATSAPP', audience: 'PERSON',
      },
      {
        code: 'WORKORDER_ASSIGNED', nameZh: '报修派工通知',
        titleZh: '有新的报修派给你', bodyZh: '{code}（{category}）{location}：{title}。请在 {sla} 小时内完成。',
        titleId: 'Perbaikan baru ditugaskan', bodyId: '{code} ({category}) {location}: {title}. Selesaikan dalam {sla} jam.',
        titleEn: 'New work order assigned', bodyEn: '{code} ({category}) {location}: {title}. Due within {sla} hours.',
        channels: 'IN_APP,WECOM', audience: 'USER',
      },
      {
        code: 'WORKORDER_DONE', nameZh: '报修完成通知',
        titleZh: '你的报修已处理完成', bodyZh: '{code}：{title} 已完成，如仍有问题请再次报修。',
        titleId: 'Perbaikan selesai', bodyId: '{code}: {title} telah selesai.',
        titleEn: 'Work order completed', bodyEn: '{code}: {title} has been completed.',
        channels: 'IN_APP,WHATSAPP', audience: 'PERSON',
      },
      {
        code: 'REQUEST_APPROVED', nameZh: '申请批准通知',
        titleZh: '你的申请已批准', bodyZh: '{code}（{type}）已批准。请到宿管室办理后续手续。',
        titleId: 'Permohonan disetujui', bodyId: '{code} ({type}) disetujui. Silakan ke kantor pengelola.',
        titleEn: 'Request approved', bodyEn: '{code} ({type}) approved. Please visit the warden office.',
        channels: 'IN_APP,WECOM,WHATSAPP', audience: 'PERSON',
      },
      {
        code: 'REQUEST_REJECTED', nameZh: '申请驳回通知',
        titleZh: '你的申请未通过', bodyZh: '{code}（{type}）未通过。原因：{comment}',
        titleId: 'Permohonan ditolak', bodyId: '{code} ({type}) ditolak. Alasan: {comment}',
        titleEn: 'Request rejected', bodyEn: '{code} ({type}) was rejected. Reason: {comment}',
        channels: 'IN_APP,WECOM,WHATSAPP', audience: 'PERSON',
      },
      {
        code: 'VIOLATION_RECORDED', nameZh: '违规记录通知',
        titleZh: '你被记录了一次违规', bodyZh: '{type}（扣 {points} 分{fine}）。请立即整改，累计超限将启动处理流程。',
        titleId: 'Pelanggaran tercatat', bodyId: '{type} (poin {points}{fine}). Mohon segera diperbaiki.',
        titleEn: 'Violation recorded', bodyEn: '{type} ({points} points{fine}). Please rectify immediately.',
        channels: 'IN_APP,WHATSAPP', audience: 'PERSON',
      },
      {
        code: 'ID_EXPIRING', nameZh: '证件到期提醒',
        titleZh: '你的证件即将到期', bodyZh: '{name}，你的 {idType} 将在 {days} 天后到期（{date}），请尽快联系人事办理续签。',
        titleId: 'Dokumen akan kedaluwarsa', bodyId: '{name}, {idType} Anda kedaluwarsa dalam {days} hari ({date}). Hubungi HRD.',
        titleEn: 'ID expiring soon', bodyEn: '{name}, your {idType} expires in {days} days ({date}). Contact HR.',
        channels: 'IN_APP,WECOM,WHATSAPP', audience: 'PERSON',
      },
      {
        code: 'RESIGNED_CHECKOUT', nameZh: '离职退宿待办',
        titleZh: '有离职人员需要办理退宿', bodyZh: '{name}（{employeeNo}）已离职，仍占用 {room}，请尽快办理退宿并清点物品。',
        titleId: 'Karyawan resign perlu check-out', bodyId: '{name} ({employeeNo}) sudah resign tapi masih di {room}.',
        titleEn: 'Resigned staff needs check-out', bodyEn: '{name} ({employeeNo}) resigned but still occupies {room}.',
        channels: 'IN_APP,WECOM', audience: 'ROLE',
      },
      {
        code: 'ANNOUNCEMENT', nameZh: '公告推送',
        titleZh: '{title}', bodyZh: '{content}',
        titleId: '{title}', bodyId: '{content}',
        titleEn: '{title}', bodyEn: '{content}',
        channels: 'IN_APP,WECOM,WHATSAPP', audience: 'PERSON',
      },
      {
        code: 'INSPECTION_ABSENT', nameZh: '查寝未归通知',
        titleZh: '查寝未归记录', bodyZh: '{date} 夜间查寝，{name}（{room}）未在位且未报备，请说明情况。',
        titleId: 'Tidak hadir saat absensi', bodyId: '{date}, {name} ({room}) tidak hadir tanpa lapor.',
        titleEn: 'Absent at roll call', bodyEn: 'On {date}, {name} ({room}) was absent without notice.',
        channels: 'IN_APP,WHATSAPP', audience: 'PERSON',
      },
    ],
  });

  // ---------------------------------------------------------------- 示例通知
  // 给管理员几条站内信，让通知中心一进去就有东西看
  const adminUser = await prisma.user.findUnique({ where: { username: 'admin' } });
  const chief = await prisma.user.findUnique({ where: { username: 'dorm.chief' } });
  if (adminUser && chief) {
    const now = Date.now();
    await prisma.notification.createMany({
      data: [
        {
          templateCode: 'RESIGNED_CHECKOUT', channel: 'IN_APP', toUserId: chief.id, locale: 'zh',
          title: '有离职人员需要办理退宿',
          body: '本次同步发现 18 名已离职人员仍占用床位，请到「待办告警」批量清退。',
          linkPath: '/alerts', status: 'SENT', sentAt: new Date(now - 3600_000),
          createdAt: new Date(now - 3600_000), refType: 'ALERT', refId: 0,
        },
        {
          templateCode: 'ID_EXPIRING', channel: 'IN_APP', toUserId: chief.id, locale: 'zh',
          title: '61 人证件 90 天内到期',
          body: '其中 5 人已不足 10 天，请协调人事尽快办理续签。',
          linkPath: '/alerts', status: 'SENT', sentAt: new Date(now - 7200_000),
          createdAt: new Date(now - 7200_000), refType: 'ALERT', refId: 0,
        },
        {
          templateCode: 'WORKORDER_ASSIGNED', channel: 'IN_APP', toUserId: adminUser.id, locale: 'zh',
          title: '62 个报修工单已超时', body: '影响住宿的工单会一直占着房间，请优先派工。',
          linkPath: '/workorders', status: 'SENT', sentAt: new Date(now - 1800_000),
          createdAt: new Date(now - 1800_000), refType: 'ALERT', refId: 0,
        },
        // 一条外部渠道的样例：渠道未启用，状态是 SKIPPED，原因写得很清楚
        {
          templateCode: 'ANNOUNCEMENT', channel: 'WHATSAPP', toPersonId: null, toAddress: '+62 812-0000-0000',
          locale: 'id', title: 'Air mati Sabtu ini di Gedung A & B',
          body: 'Sabtu 09:00-15:00 air dimatikan untuk perbaikan pipa.',
          status: 'SKIPPED', error: 'WHATSAPP 渠道未启用（设置 → 集成对接）',
          createdAt: new Date(now - 900_000),
        },
      ],
    });
  }

  // ---------------------------------------------------------------- 同步日志样例
  await prisma.syncLog.create({
    data: {
      provider: 'EXCEL', kind: 'PERSON',
      startedAt: new Date(Date.now() - 86400_000), finishedAt: new Date(Date.now() - 86400_000 + 12_000),
      status: 'SUCCESS', created: 2500, updated: 0, deactivated: 0,
      message: '初始化导入（模拟数据）', operator: 'seed',
    },
  });


  // ---------------------------------------------------------------- 自助端演示数据
  // 挑几个在住员工，造几条「员工自己提的」工单和申请，让自助端一进去就有东西看
  const selfDemoPersons = await prisma.person.findMany({
    where: { employmentStatus: 'ACTIVE', occupancies: { some: { status: { in: ['ACTIVE', 'HELD'] } } } },
    include: { occupancies: { where: { status: { in: ['ACTIVE', 'HELD'] } }, include: { bed: true } } },
    take: 12,
  });
  const woCats = await prisma.workOrderCategory.findMany();
  const selfWo: any[] = [];
  const selfReq: any[] = [];
  selfDemoPersons.forEach((p, i) => {
    const cat = woCats[i % woCats.length];
    selfWo.push({
      code: `WOS${String(10001 + i).slice(1)}`,
      categoryId: cat.id, priority: 'NORMAL',
      title: ['房间空调不制冷', '卫生间下水慢', '床头灯不亮', '门锁卡涩', '热水器没热水'][i % 5],
      description: '员工自助端提交',
      scopeType: 'ROOM', scopeId: p.occupancies[0].bed.roomId,
      reportedById: p.id, reporterName: p.name,
      reportedAt: new Date(Date.now() - (i + 1) * 36e5 * 8),
      status: ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'DONE'][i % 4],
      assignedTo: i % 4 === 0 ? null : '维修一组',
    });
    if (i < 5) {
      selfReq.push({
        code: `REQS${String(10001 + i).slice(1)}`,
        type: ['TRANSFER', 'VISITOR_OVERNIGHT', 'EXTRA_BED', 'TRANSFER', 'CHECKOUT'][i],
        personId: p.id,
        reason: ['与室友作息冲突，申请调换房间', '家属周末来访，申请留宿两晚',
          '同乡临时到岗，申请加床', '想调到有空调的房间', '合同到期，申请退宿'][i],
        status: i < 3 ? 'PENDING' : 'APPROVED',
        submittedBy: `${p.name}（自助端）`,
        submittedAt: new Date(Date.now() - (i + 1) * 36e5 * 20),
        approvedBy: i < 3 ? null : '宿舍主管',
        approvedAt: i < 3 ? null : new Date(Date.now() - i * 36e5 * 5),
      });
    }
  });
  if (selfWo.length) await prisma.workOrder.createMany({ data: selfWo });
  if (selfReq.length) await prisma.request.createMany({ data: selfReq });

  // 给这几个人发几条站内通知，自助端「我的通知」才不是空的
  const selfNotis: any[] = [];
  for (const p of selfDemoPersons.slice(0, 8)) {
    selfNotis.push({
      templateCode: 'ANNOUNCEMENT', channel: 'IN_APP', toPersonId: p.id,
      locale: p.nationalityId === 'CN' ? 'zh' : p.nationalityId === 'ID' ? 'id' : 'en',
      title: p.nationalityId === 'ID' ? 'Air mati Sabtu ini' : '本周六停水检修',
      body: p.nationalityId === 'ID'
        ? 'Sabtu 09:00-15:00 air dimatikan untuk perbaikan pipa. Mohon siapkan air.'
        : '本周六 09:00-15:00 停水进行管道检修，请提前储水。',
      status: 'SENT', sentAt: new Date(Date.now() - 2 * 36e5), createdAt: new Date(Date.now() - 2 * 36e5),
    });
  }
  if (selfNotis.length) await prisma.notification.createMany({ data: selfNotis });

  console.log(`  自助端演示：工单 ${selfWo.length} 条、申请 ${selfReq.length} 条、通知 ${selfNotis.length} 条`);
  console.log(`  自助端可用工号示例：${selfDemoPersons.slice(0, 3).map((p) => p.employeeNo).join(' / ')}`);

  await prisma.settingItem.createMany({
    data: [
      { key: 'self.baseUrl', group: 'self', description: '员工自助端基址（房门二维码里用，填园区内网地址）', value: JSON.stringify('') },
      { key: 'self.enabled', group: 'self', description: '是否开放员工自助端', value: 'true' },
    ],
  });

  const uCount = await prisma.user.count();
  console.log(`  账号 ${uCount} 个（初始密码 ${DEMO_PASSWORD}，除 admin 外首登强制改密）`);
  const [iCount, tCount] = await Promise.all([prisma.integration.count(), prisma.notificationTemplate.count()]);
  console.log(`  集成平台占位 ${iCount} 个（企微/钉钉/飞书/Teams/泛微/致远/用友HR/OA/海康/大华/LDAP/短信/邮件/WhatsApp/Webhook），均未配置`);
  console.log(`  通知模板 ${tCount} 个（三语）`);
}
