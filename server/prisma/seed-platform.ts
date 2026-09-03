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
        provider: 'AZURE_AD', nameZh: 'Microsoft Teams / Entra ID', nameEn: 'Microsoft Teams / Entra ID', nameId: 'Microsoft Teams / Entra ID',
        capabilities: 'SSO,SYNC,NOTIFY', sortOrder: 4,
        note: '有欧美合资方 / 用 M365 时才需要，通常只覆盖办公室人员。',
      },
      {
        provider: 'OA_HTTP', nameZh: '公司 OA / HR 接口', nameEn: 'Corporate OA / HR API', nameId: 'API OA / HR',
        capabilities: 'SYNC,APPROVAL', sortOrder: 5,
        note: '花名册的唯一来源。接上之后「离职未退宿」才能真正根治。',
      },
      {
        provider: 'LDAP', nameZh: 'LDAP / AD 域', nameEn: 'LDAP / Active Directory', nameId: 'LDAP / Active Directory',
        capabilities: 'SSO,SYNC', sortOrder: 6,
        note: '园区内网已有域控时可用。',
      },
      {
        provider: 'SMS', nameZh: '短信网关', nameEn: 'SMS Gateway', nameId: 'Gerbang SMS',
        capabilities: 'NOTIFY', sortOrder: 7,
        note: '兜底渠道：不装任何 App 的工人也能收到。',
      },
      {
        provider: 'SMTP', nameZh: '邮件 SMTP', nameEn: 'Email SMTP', nameId: 'Email SMTP',
        capabilities: 'NOTIFY', sortOrder: 8,
        note: '给管理层发日报 / 周报用。',
      },
    ],
  });

  // ---------------------------------------------------------------- 通知模板
  await prisma.notificationTemplate.createMany({
    data: [
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

  const uCount = await prisma.user.count();
  console.log(`  账号 ${uCount} 个（初始密码 ${DEMO_PASSWORD}，除 admin 外首登强制改密）`);
  console.log('  集成占位 8 个（企业微信 / 钉钉 / WhatsApp / Teams / OA / LDAP / 短信 / 邮件），均未配置');
  console.log('  通知模板 11 个（三语）');
}
