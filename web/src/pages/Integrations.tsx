import { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Space, Button, App, Modal, Form, Input, Switch, Alert,
  Tabs, Typography, Row, Col, Statistic, Descriptions, Upload,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useAuth } from '../auth';

const CAP_LABEL: Record<string, { label: string; color: string; desc: string }> = {
  SSO: { label: '扫码登录', color: 'blue', desc: '员工不用再记一套密码' },
  SYNC: { label: '人员同步', color: 'green', desc: '花名册单一来源，离职自动触发退宿' },
  NOTIFY: { label: '消息推送', color: 'purple', desc: '工单、审批、证件到期直接推到手机' },
  APPROVAL: { label: '审批流', color: 'orange', desc: '走公司现有 OA 审批，最复杂，建议缓做' },
};

/**
 * 集成对接。
 * 一个平台可以同时提供多种能力，凭据填全后才能启用。
 * secret 类字段返回的是打码值，回填不改动原值。
 */
export default function Integrations() {
  const { can } = useAuth();
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = () => api.integrations().then(setRows);
  useEffect(() => {
    load();
    api.notificationTemplates().then(setTemplates).catch(() => {});
    api.syncLogs().then(setSyncLogs).catch(() => {});
  }, []);

  const enabledCount = rows.filter((r) => r.enabled).length;
  const configuredCount = rows.filter((r) => r.status === 'CONFIGURED').length;

  const openEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({ ...r.config, enabled: r.enabled, note: r.note });
  };

  const save = async () => {
    const v = await form.validateFields();
    const { enabled, note, ...config } = v;
    try {
      await api.updateIntegration(editing.id, { config, enabled, note });
      message.success('已保存');
      setEditing(null);
      load();
    } catch (e: any) {
      if (e.body?.missing) {
        modal.error({
          title: '凭据未填完，不能启用',
          content: <ul style={{ paddingLeft: 18 }}>{e.body.missing.map((m: string) => <li key={m}>{m}</li>)}</ul>,
        });
      } else message.error(e.message);
    }
  };

  const platforms = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert
        type="info" showIcon
        message="对接分四种能力，价值和难度差很远"
        description={
          <div style={{ fontSize: 12, lineHeight: 1.9 }}>
            <b>人员同步</b>价值最高 —— 花名册有唯一来源，离职才能自动触发退宿。<br />
            <b>消息推送</b>投入产出比最好 —— 实现最简单，员工立刻有感。<br />
            <b>扫码登录</b>解决"不给上万工人发密码"的问题。<br />
            <b>审批流对接</b>最复杂，每家 OA 都不一样，建议先用系统自带审批。<br />
            <span style={{ color: '#d46b08' }}>
              注意：印尼籍员工基本不用企业微信 / 钉钉，他们用 WhatsApp —— 两条通道都要留。
            </span>
          </div>
        }
      />

      <Row gutter={12}>
        <Col span={8}><Card size="small"><Statistic title="已启用平台" value={enabledCount} suffix={`/ ${rows.length}`} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="凭据已填全" value={configuredCount} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="通知模板" value={templates.length} /></Card></Col>
      </Row>

      <Table
        size="small" rowKey="id" dataSource={rows} pagination={false}
        columns={[
          { title: '平台', dataIndex: 'nameZh', width: 210,
            render: (v, r: any) => <Space direction="vertical" size={0}>
              <b>{v}</b>
              <span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.provider}</span>
            </Space> },
          { title: '能力', width: 260, render: (_, r: any) => (
              <Space size={4} wrap>
                {r.capabilities.map((c: string) => (
                  <Tag key={c} color={CAP_LABEL[c]?.color} title={CAP_LABEL[c]?.desc}>
                    {CAP_LABEL[c]?.label ?? c}
                  </Tag>
                ))}
              </Space>
            ) },
          { title: '凭据', width: 110, align: 'center',
            render: (_, r: any) => (
              <Tag color={r.filledCount === 0 ? 'default' : r.status === 'CONFIGURED' ? 'green' : 'orange'}>
                {r.filledCount}/{r.fieldCount}
              </Tag>
            ) },
          { title: '状态', dataIndex: 'enabled', width: 100,
            render: (v, r: any) => v
              ? <Tag color="green">已启用</Tag>
              : <Tag color={r.status === 'CONFIGURED' ? 'orange' : 'default'}>
                  {r.status === 'CONFIGURED' ? '待启用' : '未配置'}
                </Tag> },
          { title: '说明', dataIndex: 'note', ellipsis: true },
          {
            title: '', width: 150, render: (_, r: any) => can('config:write') && (
              <Space size={4}>
                <Button size="small" onClick={() => openEdit(r)}>配置</Button>
                <Button size="small" type="link" onClick={async () => {
                  try {
                    const t = await api.testIntegration(r.id);
                    modal.info({ title: '自检结果', content: t.message ?? '凭据完整' });
                  } catch (e: any) {
                    modal.error({
                      title: '自检未通过',
                      content: e.body?.missing
                        ? <ul style={{ paddingLeft: 18 }}>{e.body.missing.map((m: string) => <li key={m}>{m}</li>)}</ul>
                        : e.message,
                    });
                  }
                }}>自检</Button>
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );

  const templatePane = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon
        message="业务代码只管「发生了什么」，不管发到哪个平台"
        description="每个模板配置发哪些渠道；收件人是中方就发中文、印尼籍就发 Bahasa、其余发英文。换平台不用动业务代码。" />
      <Table
        size="small" rowKey="id" dataSource={templates} pagination={false} scroll={{ x: 1000 }}
        columns={[
          { title: '模板', dataIndex: 'nameZh', width: 150 },
          { title: '编码', dataIndex: 'code', width: 190, render: (v) => <code style={{ fontSize: 11 }}>{v}</code> },
          { title: '中文标题', dataIndex: 'titleZh', width: 200, ellipsis: true },
          { title: 'Bahasa', dataIndex: 'titleId', width: 200, ellipsis: true },
          { title: '发送渠道', dataIndex: 'channels', width: 220,
            render: (v: string) => <Space size={2} wrap>
              {v.split(',').map((c) => <Tag key={c}>{c === 'IN_APP' ? '站内' : c}</Tag>)}
            </Space> },
          { title: '启用', dataIndex: 'enabled', width: 80,
            render: (v, r: any) => <Switch size="small" checked={v} disabled={!can('config:write')}
              onChange={async (nv) => {
                await api.updateNotificationTemplate(r.id, { enabled: nv });
                message.success('已保存');
                api.notificationTemplates().then(setTemplates);
              }} /> },
        ]}
      />
    </Space>
  );

  const syncPane = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert
        type="warning" showIcon
        message="人员同步是「离职未退宿」的根治点"
        description={
          <div style={{ fontSize: 12, lineHeight: 1.9 }}>
            外部系统把某人标记为离职时，本系统会自动生成一条<b>已批准的退宿待办</b>并推送给对应楼栋宿管，
            不用等宿管自己发现。<br />
            接口是 <code>POST /api/sync/persons</code>，Excel 导入和企微 / 钉钉 / OA / LDAP 拉取走的是同一个入口。
          </div>
        } />
      <Card size="small" title="同步记录" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" dataSource={syncLogs} pagination={{ pageSize: 10, size: 'small' }}
          columns={[
            { title: '来源', dataIndex: 'provider', width: 110, render: (v) => <Tag>{v}</Tag> },
            { title: '类型', dataIndex: 'kind', width: 100 },
            { title: '开始', dataIndex: 'startedAt', width: 170, render: (v) => new Date(v).toLocaleString() },
            { title: '状态', dataIndex: 'status', width: 100,
              render: (v) => <Tag color={v === 'SUCCESS' ? 'green' : v === 'FAILED' ? 'red' : 'blue'}>{v}</Tag> },
            { title: '新增', dataIndex: 'created', width: 80, align: 'right' },
            { title: '更新', dataIndex: 'updated', width: 80, align: 'right' },
            { title: '触发退宿', dataIndex: 'deactivated', width: 100, align: 'right',
              render: (v) => (v ? <Tag color="orange">{v}</Tag> : '—') },
            { title: '备注', dataIndex: 'message', ellipsis: true },
          ]}
        />
      </Card>
    </Space>
  );

  return (
    <Card size="small">
      <Tabs items={[
        { key: 'platforms', label: '平台对接', children: platforms },
        { key: 'templates', label: '通知模板', children: templatePane },
        { key: 'sync', label: '人员同步', children: syncPane },
      ]} />

      <Modal
        open={!!editing} width={620} title={editing ? `配置 ${editing.nameZh}` : ''}
        onCancel={() => setEditing(null)} onOk={save}
      >
        {editing && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="能力">
                <Space size={4} wrap>
                  {editing.capabilities.map((c: string) => (
                    <Tag key={c} color={CAP_LABEL[c]?.color}>{CAP_LABEL[c]?.label ?? c}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="说明">{editing.note}</Descriptions.Item>
            </Descriptions>
            <Form form={form} layout="vertical">
              {editing.fields.map((f: any) => (
                <Form.Item key={f.key} name={f.key} label={f.label} extra={f.hint}>
                  {f.secret ? <Input.Password placeholder="留空表示不修改" /> : <Input />}
                </Form.Item>
              ))}
              <Form.Item name="note" label="备注"><Input /></Form.Item>
              <Form.Item name="enabled" label="启用" valuePropName="checked"
                extra="凭据没填全时不允许启用">
                <Switch />
              </Form.Item>
            </Form>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              凭据保存后仅以打码形式返回；启用后，通知中心的外发队列才会真正投递到这个平台。
            </Typography.Text>
          </Space>
        )}
      </Modal>
    </Card>
  );
}
