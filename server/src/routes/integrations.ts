import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireAuth, requirePerm, audit } from '../services/auth.js';
import { notify, flushOutbox } from '../services/notify.js';

/**
 * 集成对接 + 通知中心。
 *
 * 集成分四种能力，一个平台可以同时具备多种：
 *   SSO      扫码登录
 *   SYNC     人员 / 组织架构同步
 *   NOTIFY   消息推送
 *   APPROVAL 审批流对接
 *
 * 凭据字段（含 secret / token）返回给前端时打码，只显示是否已填。
 */

/** 每个平台需要哪些配置字段 —— 前端据此渲染表单，也是接入时的清单 */
export const PROVIDER_FIELDS: Record<string, Array<{ key: string; label: string; secret?: boolean; hint?: string }>> = {
  WECOM: [
    { key: 'corpId', label: '企业 CorpID' },
    { key: 'agentId', label: '应用 AgentId' },
    { key: 'corpSecret', label: '应用 Secret', secret: true },
    { key: 'contactSecret', label: '通讯录同步 Secret', secret: true, hint: '做人员同步才需要' },
  ],
  DINGTALK: [
    { key: 'corpId', label: '企业 CorpId' },
    { key: 'appKey', label: 'AppKey' },
    { key: 'appSecret', label: 'AppSecret', secret: true },
    { key: 'agentId', label: '微应用 AgentId' },
  ],
  AZURE_AD: [
    { key: 'tenantId', label: '租户 Tenant ID' },
    { key: 'clientId', label: '应用 Client ID' },
    { key: 'clientSecret', label: 'Client Secret', secret: true },
  ],
  WHATSAPP: [
    { key: 'phoneNumberId', label: 'Phone Number ID' },
    { key: 'businessAccountId', label: 'WABA ID' },
    { key: 'accessToken', label: 'Access Token', secret: true },
    { key: 'templateNamespace', label: '模板命名空间', hint: '会话窗口外只能发已审核模板' },
  ],
  LDAP: [
    { key: 'url', label: 'LDAP 地址', hint: 'ldap://host:389' },
    { key: 'baseDn', label: 'Base DN' },
    { key: 'bindDn', label: 'Bind DN' },
    { key: 'bindPassword', label: 'Bind 密码', secret: true },
  ],
  OA_HTTP: [
    { key: 'baseUrl', label: 'OA 接口地址' },
    { key: 'appId', label: 'AppId' },
    { key: 'appSecret', label: 'AppSecret', secret: true },
    { key: 'personEndpoint', label: '花名册接口路径', hint: '用于人员同步' },
  ],
  LARK: [
    { key: 'appId', label: 'App ID' },
    { key: 'appSecret', label: 'App Secret', secret: true },
  ],
  WEAVER_ECOLOGY: [
    { key: 'baseUrl', label: 'e-cology 地址', hint: 'http://oa.company.com' },
    { key: 'appId', label: '注册应用 appid' },
    { key: 'aesKey', label: '应用 SecretKey', secret: true },
    { key: 'syncUser', label: '同步接口账号' },
    { key: 'workflowId', label: '审批流程 ID', hint: '做审批流对接才需要' },
  ],
  SEEYON: [
    { key: 'baseUrl', label: '致远 A8 地址' },
    { key: 'appKey', label: 'AppKey' },
    { key: 'appSecret', label: 'AppSecret', secret: true },
  ],
  HIKVISION: [
    { key: 'baseUrl', label: '综合安防平台地址', hint: 'https://ip:443（iSecure Center / HikCentral）' },
    { key: 'appKey', label: 'AppKey（合作方 Key）' },
    { key: 'appSecret', label: 'AppSecret', secret: true },
    { key: 'streamProtocol', label: '取流协议', hint: 'hls / rtsp / ws-flv，二期视频接入用' },
    { key: 'gatewayUrl', label: '视频网关地址', hint: 'go2rtc / MediaMTX，主应用不碰码流' },
  ],
  DAHUA: [
    { key: 'baseUrl', label: 'DSS 平台地址' },
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret', secret: true },
    { key: 'gatewayUrl', label: '视频网关地址', hint: 'go2rtc / MediaMTX' },
  ],
  YONYOU_HR: [
    { key: 'baseUrl', label: '用友 / 金蝶 接口地址' },
    { key: 'appKey', label: 'AppKey' },
    { key: 'appSecret', label: 'AppSecret', secret: true },
    { key: 'orgCode', label: '组织编码', hint: '只同步某个组织时填' },
  ],
  WEBHOOK: [
    { key: 'url', label: 'Webhook 地址', hint: '通用出站，POST JSON' },
    { key: 'secret', label: '签名密钥', secret: true },
  ],
  SMTP: [
    { key: 'host', label: 'SMTP 主机' },
    { key: 'port', label: '端口' },
    { key: 'user', label: '账号' },
    { key: 'pass', label: '密码', secret: true },
  ],
  SMS: [
    { key: 'endpoint', label: '网关地址' },
    { key: 'apiKey', label: 'API Key', secret: true },
    { key: 'signature', label: '短信签名' },
  ],
};

const maskConfig = (provider: string, raw: string) => {
  let cfg: Record<string, any> = {};
  try { cfg = JSON.parse(raw || '{}'); } catch { /* 损坏的配置按空处理 */ }
  const fields = PROVIDER_FIELDS[provider] ?? [];
  const out: Record<string, any> = {};
  for (const f of fields) {
    const v = cfg[f.key];
    out[f.key] = f.secret ? (v ? '********' : '') : (v ?? '');
  }
  return out;
};

export default async function integrationRoutes(app: FastifyInstance) {
  // ==================================================== 集成配置
  app.get('/api/integrations', { preHandler: requireAuth }, async () => {
    const rows = await prisma.integration.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map((i) => {
      let cfg: Record<string, any> = {};
      try { cfg = JSON.parse(i.config || '{}'); } catch { /* ignore */ }
      const fields = PROVIDER_FIELDS[i.provider] ?? [];
      const filled = fields.filter((f) => !!cfg[f.key]).length;
      return {
        id: i.id, provider: i.provider,
        nameZh: i.nameZh, nameEn: i.nameEn, nameId: i.nameId,
        enabled: i.enabled, status: i.status,
        capabilities: i.capabilities.split(',').filter(Boolean),
        fields, config: maskConfig(i.provider, i.config),
        filledCount: filled, fieldCount: fields.length,
        lastCheckedAt: i.lastCheckedAt, note: i.note,
      };
    });
  });

  app.put<{ Params: { id: string }; Body: { config?: Record<string, any>; enabled?: boolean; note?: string } }>(
    '/api/integrations/:id',
    { preHandler: requirePerm('integration:write') },
    async (req, reply) => {
      const id = Number(req.params.id);
      const integ = await prisma.integration.findUnique({ where: { id } });
      if (!integ) return reply.code(404).send({ error: '集成不存在' });

      let cfg: Record<string, any> = {};
      try { cfg = JSON.parse(integ.config || '{}'); } catch { /* ignore */ }
      if (req.body.config) {
        for (const [k, v] of Object.entries(req.body.config)) {
          // 打码回传的字段视为「不修改」
          if (v === '********') continue;
          if (v === '' || v === null) delete cfg[k];
          else cfg[k] = v;
        }
      }
      const fields = PROVIDER_FIELDS[integ.provider] ?? [];
      const required = fields.filter((f) => !f.hint);
      const configured = required.every((f) => !!cfg[f.key]);
      const enabled = req.body.enabled ?? integ.enabled;
      if (enabled && !configured) {
        return reply.code(400).send({
          error: '凭据未填完，不能启用',
          missing: required.filter((f) => !cfg[f.key]).map((f) => f.label),
        });
      }

      const updated = await prisma.integration.update({
        where: { id },
        data: {
          config: JSON.stringify(cfg),
          enabled,
          note: req.body.note ?? integ.note,
          status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
          lastCheckedAt: new Date(),
        },
      });
      await audit(req, 'INTEGRATION_UPDATE', {
        targetType: 'Integration', targetId: id,
        detail: `${integ.provider} ${enabled ? '启用' : '停用'}`,
      });
      return { ...updated, config: maskConfig(updated.provider, updated.config) };
    }
  );

  /** 连通性自检。一期只校验凭据是否填全，真调平台接口等 adapter 实现后接上 */
  app.post<{ Params: { id: string } }>(
    '/api/integrations/:id/test',
    { preHandler: requirePerm('integration:write') },
    async (req, reply) => {
      const integ = await prisma.integration.findUnique({ where: { id: Number(req.params.id) } });
      if (!integ) return reply.code(404).send({ error: '集成不存在' });
      let cfg: Record<string, any> = {};
      try { cfg = JSON.parse(integ.config || '{}'); } catch { /* ignore */ }
      const fields = (PROVIDER_FIELDS[integ.provider] ?? []).filter((f) => !f.hint);
      const missing = fields.filter((f) => !cfg[f.key]).map((f) => f.label);
      if (missing.length) return reply.code(400).send({ ok: false, error: '缺少凭据', missing });
      return {
        ok: false,
        pending: true,
        message: `${integ.nameZh} 凭据已填全。实际连通性校验需要接入该平台 SDK / HTTP 接口，属于下一步实现。`,
      };
    }
  );

  // ==================================================== 通知中心
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/notifications',
    { preHandler: requireAuth },
    async (req) => {
      const page = Number(req.query.page ?? 1);
      const pageSize = Math.min(Number(req.query.pageSize ?? 30), 200);
      const where: any = {};
      if (req.query.mine === 'true') where.toUserId = req.auth!.sub;
      if (req.query.channel) where.channel = req.query.channel;
      if (req.query.status) where.status = req.query.status;
      if (req.query.unread === 'true') where.readAt = null;

      const [total, rows, unread] = await Promise.all([
        prisma.notification.count({ where }),
        prisma.notification.findMany({
          where,
          include: {
            toUser: { select: { name: true, username: true } },
            toPerson: { select: { name: true, employeeNo: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize, take: pageSize,
        }),
        prisma.notification.count({ where: { toUserId: req.auth!.sub, readAt: null, channel: 'IN_APP' } }),
      ]);
      return {
        total, page, pageSize, unread,
        rows: rows.map((n) => ({
          id: n.id, channel: n.channel, title: n.title, body: n.body, linkPath: n.linkPath,
          status: n.status, error: n.error, locale: n.locale,
          createdAt: n.createdAt, sentAt: n.sentAt, readAt: n.readAt,
          refType: n.refType, refId: n.refId, templateCode: n.templateCode,
          to: n.toUser?.name ?? n.toPerson?.name ?? n.toAddress ?? '—',
          toDetail: n.toUser?.username ?? n.toPerson?.employeeNo ?? null,
        })),
      };
    }
  );

  app.put<{ Params: { id: string } }>('/api/notifications/:id/read', { preHandler: requireAuth }, async (req) =>
    prisma.notification.update({ where: { id: Number(req.params.id) }, data: { readAt: new Date() } })
  );

  app.put('/api/notifications/read-all', { preHandler: requireAuth }, async (req) => {
    const r = await prisma.notification.updateMany({
      where: { toUserId: req.auth!.sub, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  });

  /** 触发一次外发队列处理。一期外部渠道都会转 SKIPPED/FAILED 并写清原因 */
  app.post('/api/notifications/flush', { preHandler: requirePerm('integration:write') }, async (req) => {
    const r = await flushOutbox();
    await audit(req, 'NOTIFY_FLUSH', { detail: JSON.stringify(r) });
    return r;
  });

  /** 发一条测试通知，验证模板渲染和渠道落库 */
  app.post<{ Body: { templateCode: string; personId?: number; userId?: number; vars?: Record<string, any> } }>(
    '/api/notifications/test',
    { preHandler: requirePerm('integration:write') },
    async (req, reply) => {
      const { templateCode, personId, userId, vars } = req.body ?? ({} as any);
      const count = await notify(
        templateCode,
        { personId, userId: userId ?? req.auth!.sub },
        vars ?? { name: '测试', code: 'TEST-0001', detail: '这是一条测试通知' }
      );
      if (count === 0) return reply.code(400).send({ error: '模板不存在或已停用，或收件人无法解析' });
      return { ok: true, created: count };
    }
  );

  // ==================================================== 通知模板
  app.get('/api/notification-templates', { preHandler: requireAuth }, async () =>
    prisma.notificationTemplate.findMany({ orderBy: { id: 'asc' } })
  );

  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/notification-templates/:id',
    { preHandler: requirePerm('integration:write') },
    async (req) => prisma.notificationTemplate.update({ where: { id: Number(req.params.id) }, data: req.body })
  );

  // ==================================================== 同步日志
  app.get('/api/sync-logs', { preHandler: requireAuth }, async () =>
    prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 50 })
  );

  /**
   * 人员同步。一期只支持从外部推 JSON（等价于 Excel 导入）；
   * 企微 / 钉钉 / OA / LDAP 拉取等凭据配好后接同一个入口。
   * 关键行为：外部标记为离职的人，会自动生成退宿待办 —— 这是「离职未退宿」的根治点。
   */
  app.post<{ Body: { provider?: string; rows: any[] } }>(
    '/api/sync/persons',
    { preHandler: requirePerm('person:write') },
    async (req, reply) => {
      const provider = req.body?.provider ?? 'EXCEL';
      const rows = req.body?.rows;
      if (!Array.isArray(rows) || rows.length === 0)
        return reply.code(400).send({ error: '没有可同步的数据' });

      const log = await prisma.syncLog.create({
        data: { provider, kind: 'PERSON', operator: req.auth?.username ?? 'system' },
      });
      let created = 0, updated = 0, deactivated = 0;
      const problems: string[] = [];

      for (const r of rows) {
        if (!r.employeeNo) { problems.push('缺少工号的行已跳过'); continue; }
        const exists = await prisma.person.findUnique({ where: { employeeNo: String(r.employeeNo) } });
        const data: any = {};
        for (const k of ['name', 'nameLocal', 'gender', 'nationalityId', 'idType', 'idNumber',
          'phone', 'positionTitle', 'employmentStatus']) {
          if (r[k] !== undefined) data[k] = r[k];
        }
        if (r.departmentCode) {
          const d = await prisma.department.findUnique({ where: { code: r.departmentCode } });
          if (d) data.departmentId = d.id;
        }
        if (r.positionLevelCode) {
          const l = await prisma.positionLevel.findUnique({ where: { code: r.positionLevelCode } });
          if (l) data.positionLevelId = l.id;
        }

        if (exists) {
          await prisma.person.update({ where: { id: exists.id }, data });
          updated++;
          // 外部说这人离职了，而系统里还占着床 → 生成退宿待办 + 通知宿管
          if (data.employmentStatus === 'RESIGNED' && exists.employmentStatus !== 'RESIGNED') {
            const occ = await prisma.occupancy.findFirst({
              where: { personId: exists.id, status: { in: ['ACTIVE', 'HELD', 'RESERVED'] } },
              include: { bed: { include: { room: true } } },
            });
            if (occ) {
              deactivated++;
              await prisma.request.create({
                data: {
                  code: `REQ${Date.now().toString().slice(-8)}${exists.id % 100}`,
                  type: 'CHECKOUT', personId: exists.id,
                  reason: `${provider} 同步：人员已离职，需办理退宿并清点物品`,
                  status: 'APPROVED', submittedBy: `sync:${provider}`,
                  approvedBy: 'system', approvedAt: new Date(),
                },
              });
              await notify('RESIGNED_CHECKOUT', { roleCode: 'WARDEN' }, {
                name: exists.name, employeeNo: exists.employeeNo, room: occ.bed.room.code,
              }, { type: 'PERSON', id: exists.id, linkPath: '/alerts' });
            }
          }
        } else {
          if (!r.nationalityId || !r.name || !r.gender || !r.idNumber) {
            problems.push(`${r.employeeNo}: 新建缺少必填字段（姓名/性别/国籍/证件号）`);
            continue;
          }
          await prisma.person.create({
            data: {
              employeeNo: String(r.employeeNo),
              personType: r.personType ?? 'EMPLOYEE',
              ...data,
              hireDate: r.hireDate ? new Date(r.hireDate) : new Date(),
            },
          });
          created++;
        }
      }

      const done = await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          finishedAt: new Date(), status: 'SUCCESS', created, updated, deactivated,
          message: problems.length ? problems.slice(0, 20).join('; ') : null,
        },
      });
      await audit(req, 'SYNC_PERSONS', { detail: `${provider} 新增${created} 更新${updated} 触发退宿${deactivated}` });
      return done;
    }
  );
}
