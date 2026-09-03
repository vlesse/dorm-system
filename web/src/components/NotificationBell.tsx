import { useEffect, useState } from 'react';
import { Badge, Drawer, List, Tag, Button, Space, Typography, Empty, App, Tabs, Table } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

const CHANNEL_LABEL: Record<string, string> = {
  IN_APP: '站内', WECOM: '企业微信', DINGTALK: '钉钉', WHATSAPP: 'WhatsApp', SMS: '短信', EMAIL: '邮件',
};
const STATUS_COLOR: Record<string, string> = {
  SENT: 'green', PENDING: 'blue', FAILED: 'red', SKIPPED: 'default',
};
const STATUS_LABEL: Record<string, string> = {
  SENT: '已发送', PENDING: '待发送', FAILED: '发送失败', SKIPPED: '渠道未启用',
};

/**
 * 通知铃铛 + 通知中心。
 * 「我的」= 发给当前账号的站内信；「全部发件」= 所有渠道的发件箱，
 * 能一眼看出哪些消息因为平台没配置而没发出去。
 */
export default function NotificationBell() {
  const nav = useNavigate();
  const { can } = useAuth();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<any[]>([]);
  const [all, setAll] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  const load = async () => {
    const r = await api.notifications({ mine: 'true', pageSize: 30 });
    setMine(r.rows);
    setUnread(r.unread);
  };
  const loadAll = async () => {
    const r = await api.notifications({ pageSize: 50 });
    setAll(r.rows);
  };

  useEffect(() => { load().catch(() => {}); }, []);
  useEffect(() => {
    if (!open) return;
    load().catch(() => {});
    loadAll().catch(() => {});
  }, [open]);

  const openItem = async (n: any) => {
    if (!n.readAt) { await api.readNotification(n.id); load(); }
    if (n.linkPath) { setOpen(false); nav(n.linkPath); }
  };

  const skipped = all.filter((n) => n.status === 'SKIPPED' || n.status === 'FAILED');

  return (
    <>
      <Badge count={unread} size="small" offset={[-4, 4]}>
        <Button type="text" icon={<BellOutlined style={{ color: '#fff', fontSize: 18 }} />}
          onClick={() => setOpen(true)} />
      </Badge>

      <Drawer open={open} onClose={() => setOpen(false)} width={560} title="通知中心"
        extra={
          <Space>
            {unread > 0 && (
              <Button size="small" onClick={async () => { await api.readAllNotifications(); load(); }}>
                全部标记已读
              </Button>
            )}
            {can('integration:write') && (
              <Button size="small" onClick={async () => {
                const r = await api.flushNotifications();
                message.info(`处理 ${r.processed} 条：成功 ${r.sent}，失败 ${r.failed}`);
                loadAll();
              }}>处理外发队列</Button>
            )}
          </Space>
        }
      >
        <Tabs
          items={[
            {
              key: 'mine', label: `我的（${unread}）`,
              children: mine.length === 0 ? <Empty description="暂无通知" /> : (
                <List
                  size="small" dataSource={mine}
                  renderItem={(n: any) => (
                    <List.Item
                      style={{ cursor: n.linkPath ? 'pointer' : undefined, background: n.readAt ? undefined : '#f0f7ff' }}
                      onClick={() => openItem(n)}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={6}>
                            {!n.readAt && <Badge status="processing" />}
                            <span>{n.title}</span>
                            <Tag>{CHANNEL_LABEL[n.channel] ?? n.channel}</Tag>
                          </Space>
                        }
                        description={
                          <div>
                            <div style={{ color: '#595959' }}>{n.body}</div>
                            <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 4 }}>
                              {new Date(n.createdAt).toLocaleString()}
                              {n.linkPath && <span style={{ marginLeft: 8, color: '#1677ff' }}>点击查看 →</span>}
                            </div>
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              ),
            },
            {
              key: 'outbox', label: `发件箱（${all.length}）`,
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={10}>
                  {skipped.length > 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      有 {skipped.length} 条消息没发出去 —— 基本都是因为对应平台还没在「设置 → 集成对接」里配置启用。
                    </Typography.Text>
                  )}
                  <Table
                    size="small" rowKey="id" dataSource={all} pagination={{ pageSize: 12, size: 'small' }}
                    columns={[
                      { title: '渠道', dataIndex: 'channel', width: 90,
                        render: (v) => <Tag>{CHANNEL_LABEL[v] ?? v}</Tag> },
                      { title: '收件人', dataIndex: 'to', width: 130, ellipsis: true },
                      { title: '标题', dataIndex: 'title', ellipsis: true },
                      { title: '状态', dataIndex: 'status', width: 110,
                        render: (v, r: any) => (
                          <Tag color={STATUS_COLOR[v]} title={r.error ?? ''}>{STATUS_LABEL[v] ?? v}</Tag>
                        ) },
                    ]}
                    expandable={{
                      expandedRowRender: (r: any) => (
                        <div style={{ fontSize: 12 }}>
                          <div>{r.body}</div>
                          {r.error && <div style={{ color: '#cf1322', marginTop: 6 }}>原因：{r.error}</div>}
                        </div>
                      ),
                    }}
                  />
                </Space>
              ),
            },
          ]}
        />
      </Drawer>
    </>
  );
}
