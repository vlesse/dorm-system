import { prisma } from '../db.js';

/**
 * 通知中心。
 *
 * 设计要点：**业务代码只管"发生了什么"，不管"发到哪个平台"。**
 * 触发点调用 notify()，通知中心负责：
 *   1. 查模板 → 按收件人的语言渲染（中文 / Bahasa / English）
 *   2. 按模板配置的渠道，逐个渠道落一条 Notification 记录
 *   3. 站内信（IN_APP）直接就绪；外部渠道交给 adapter 发送
 *
 * 为什么这么分：中方员工用企业微信 / 钉钉，印尼籍员工用 WhatsApp，
 * 管理端可能只看站内信。同一条业务事件要能同时走多个渠道，
 * 而且以后换平台不该动业务代码。
 */

export type Channel = 'IN_APP' | 'WECOM' | 'DINGTALK' | 'WHATSAPP' | 'SMS' | 'EMAIL';

export interface OutboundMessage {
  channel: Channel;
  toAddress: string | null;
  locale: string;
  title: string;
  body: string;
  linkPath?: string | null;
}

/** 外部渠道适配器接口。接入具体平台时实现这个即可，业务代码一行不用改。 */
export interface ChannelAdapter {
  channel: Channel;
  /** 平台是否已配置好凭据 */
  isReady(config: Record<string, any>): boolean;
  /** 发送。抛错即视为失败，会写进 Notification.error */
  send(msg: OutboundMessage, config: Record<string, any>): Promise<void>;
}

/**
 * 各平台适配器占位。
 * 一期只有站内信真发；其余登记为「未配置」，等企业凭据填进来后实现 send()。
 * 每个占位里写清楚了接进来需要什么，免得以后重新查文档。
 */
const ADAPTERS: Record<string, ChannelAdapter> = {
  WECOM: {
    channel: 'WECOM',
    isReady: (c) => !!(c.corpId && c.corpSecret && c.agentId),
    async send() {
      // 企业微信应用消息：POST /cgi-bin/message/send?access_token=…
      // 需要 corpId / corpSecret / agentId，toAddress = 企微 UserId
      throw new Error('企业微信适配器尚未启用：请先在「设置 → 集成对接」填入 corpId / corpSecret / agentId');
    },
  },
  DINGTALK: {
    channel: 'DINGTALK',
    isReady: (c) => !!(c.appKey && c.appSecret && c.agentId),
    async send() {
      // 钉钉工作通知：POST /topapi/message/corpconversation/asyncsend_v2
      // 需要 appKey / appSecret / agentId，toAddress = 钉钉 userid
      throw new Error('钉钉适配器尚未启用：请先在「设置 → 集成对接」填入 appKey / appSecret / agentId');
    },
  },
  WHATSAPP: {
    channel: 'WHATSAPP',
    isReady: (c) => !!(c.phoneNumberId && c.accessToken),
    async send() {
      // WhatsApp Business Cloud API：POST /{phone-number-id}/messages
      // 印尼籍员工的主要触达渠道。注意：非会话窗口内只能发已审核的模板消息
      throw new Error('WhatsApp 适配器尚未启用：请先在「设置 → 集成对接」填入 phoneNumberId / accessToken');
    },
  },
  SMS: {
    channel: 'SMS',
    isReady: (c) => !!(c.endpoint && c.apiKey),
    async send() {
      throw new Error('短信适配器尚未启用');
    },
  },
  EMAIL: {
    channel: 'EMAIL',
    isReady: (c) => !!(c.host && c.user),
    async send() {
      throw new Error('邮件适配器尚未启用');
    },
  },
};

const PROVIDER_BY_CHANNEL: Record<string, string> = {
  WECOM: 'WECOM', DINGTALK: 'DINGTALK', WHATSAPP: 'WHATSAPP', SMS: 'SMS', EMAIL: 'SMTP',
};

function render(tpl: string, vars: Record<string, any>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`) as string);
}

function pickLocale(t: any, locale: string) {
  if (locale === 'id') return { title: t.titleId ?? t.titleZh, body: t.bodyId ?? t.bodyZh };
  if (locale === 'en') return { title: t.titleEn ?? t.titleZh, body: t.bodyEn ?? t.bodyZh };
  return { title: t.titleZh, body: t.bodyZh };
}

/** 员工的语言：中方看中文，印尼籍看 Bahasa，其余看英文 */
function localeOfPerson(p: { nationalityId: string; languages: string | null }) {
  if (p.nationalityId === 'CN') return 'zh';
  if (p.nationalityId === 'ID') return 'id';
  return 'en';
}

export interface NotifyTarget {
  personId?: number;
  userId?: number;
  /** 通知某个角色的全部账号，如把工单派给 WARDEN */
  roleCode?: string;
}

/**
 * 发通知。业务代码只调这个。
 * 返回生成的通知条数。
 */
export async function notify(
  templateCode: string,
  target: NotifyTarget,
  vars: Record<string, any> = {},
  ref?: { type: string; id: number; linkPath?: string }
): Promise<number> {
  const tpl = await prisma.notificationTemplate.findUnique({ where: { code: templateCode } });
  if (!tpl || !tpl.enabled) return 0;

  const channels = tpl.channels.split(',').map((s) => s.trim()).filter(Boolean) as Channel[];

  // 解析收件人
  type Recipient = { personId?: number; userId?: number; locale: string; addresses: Record<string, string> };
  const recipients: Recipient[] = [];

  if (target.personId) {
    const p = await prisma.person.findUnique({
      where: { id: target.personId },
      include: { identities: true },
    });
    if (p) {
      const addresses: Record<string, string> = {};
      for (const b of p.identities) if (b.isActive) addresses[b.provider] = b.externalId;
      if (p.phone) { addresses.SMS ??= p.phone; addresses.WHATSAPP ??= p.phone; }
      recipients.push({ personId: p.id, locale: localeOfPerson(p), addresses });
    }
  }
  if (target.userId) {
    const u = await prisma.user.findUnique({ where: { id: target.userId }, include: { identities: true } });
    if (u) {
      const addresses: Record<string, string> = {};
      for (const b of u.identities) if (b.isActive) addresses[b.provider] = b.externalId;
      if (u.phone) { addresses.SMS ??= u.phone; addresses.WHATSAPP ??= u.phone; }
      recipients.push({ userId: u.id, locale: u.locale, addresses });
    }
  }
  if (target.roleCode) {
    const us = await prisma.user.findMany({
      where: { isActive: true, role: { code: target.roleCode } },
      include: { identities: true },
    });
    for (const u of us) {
      const addresses: Record<string, string> = {};
      for (const b of u.identities) if (b.isActive) addresses[b.provider] = b.externalId;
      if (u.phone) { addresses.SMS ??= u.phone; addresses.WHATSAPP ??= u.phone; }
      recipients.push({ userId: u.id, locale: u.locale, addresses });
    }
  }
  if (recipients.length === 0) return 0;

  // 各外部平台的配置（判断渠道是否可用）
  const integrations = await prisma.integration.findMany();
  const cfgByProvider = new Map(integrations.map((i) => [i.provider, i]));

  const rows: any[] = [];
  for (const r of recipients) {
    const { title, body } = pickLocale(tpl, r.locale);
    for (const ch of channels) {
      const isInApp = ch === 'IN_APP';
      const provider = PROVIDER_BY_CHANNEL[ch];
      const integ = provider ? cfgByProvider.get(provider) : undefined;
      const addr = isInApp ? null : (r.addresses[provider ?? ch] ?? null);

      let status = 'PENDING';
      let error: string | null = null;
      if (isInApp) {
        status = 'SENT';
      } else if (!integ?.enabled) {
        status = 'SKIPPED';
        error = `${ch} 渠道未启用（设置 → 集成对接）`;
      } else if (!addr) {
        status = 'SKIPPED';
        error = `收件人没有绑定 ${ch} 身份`;
      }

      rows.push({
        templateCode, channel: ch,
        toUserId: r.userId ?? null, toPersonId: r.personId ?? null, toAddress: addr,
        locale: r.locale,
        title: render(title, vars), body: render(body, vars),
        linkPath: ref?.linkPath ?? null,
        status, error,
        sentAt: status === 'SENT' ? new Date() : null,
        refType: ref?.type ?? null, refId: ref?.id ?? null,
      });
    }
  }
  if (rows.length) await prisma.notification.createMany({ data: rows });
  return rows.length;
}

/**
 * 处理待发队列：把 PENDING 的外部渠道通知交给对应 adapter。
 * 一期所有 adapter 都会抛「尚未启用」，通知会转成 FAILED 并把原因写清楚 ——
 * 这样在「通知中心」里一眼能看出缺哪个平台的配置。
 */
export async function flushOutbox(limit = 100) {
  const pending = await prisma.notification.findMany({
    where: { status: 'PENDING', channel: { not: 'IN_APP' } },
    take: limit,
  });
  const integrations = await prisma.integration.findMany();
  const cfgByProvider = new Map(integrations.map((i) => [i.provider, i]));
  let sent = 0, failed = 0;

  for (const n of pending) {
    const adapter = ADAPTERS[n.channel];
    const provider = PROVIDER_BY_CHANNEL[n.channel];
    const integ = provider ? cfgByProvider.get(provider) : undefined;
    let config: Record<string, any> = {};
    try { config = JSON.parse(integ?.config ?? '{}'); } catch { /* 配置损坏按空处理 */ }

    if (!adapter || !integ?.enabled) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: 'SKIPPED', error: `${n.channel} 渠道未启用` },
      });
      continue;
    }
    try {
      await adapter.send(
        { channel: n.channel as Channel, toAddress: n.toAddress, locale: n.locale, title: n.title, body: n.body, linkPath: n.linkPath },
        config
      );
      await prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
      sent++;
    } catch (e: any) {
      await prisma.notification.update({ where: { id: n.id }, data: { status: 'FAILED', error: e.message } });
      failed++;
    }
  }
  return { processed: pending.length, sent, failed };
}

export function adapterReadiness() {
  return Object.values(ADAPTERS).map((a) => ({ channel: a.channel, implemented: false }));
}
