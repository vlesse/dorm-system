import { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Space, Select, Button, App, Modal, Form, Input, Switch,
  Row, Col, Statistic, Alert, DatePicker,
} from 'antd';
import dayjs from 'dayjs';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { useMeta, VISITOR_STATUS_LABEL, labelOf } from '../meta';

/**
 * 访客登记。
 * 关键点：留宿（overnight）必须审批 —— 私自留宿外人既是治安问题，
 * 也会让消防疏散名单对不上人。不留宿的直接放行。
 */
export default function Visitors() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message } = App.useApp();

  const [rows, setRows] = useState<any[]>([]);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [personOptions, setPersonOptions] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.visitors(filters).then(setRows).finally(() => setLoading(false));
  };
  useEffect(load, [JSON.stringify(filters)]);

  const searchPersons = async (q: string) => {
    if (!q) return;
    const r = await api.persons({ q, pageSize: 20 });
    setPersonOptions(r.rows.map((p: any) => ({
      value: p.id,
      label: `${p.name}（${p.employeeNo}）${p.accommodation ? ' · ' + p.accommodation.roomCode : ''}`,
      roomId: p.accommodation?.roomId,
    })));
  };

  const update = async (id: number, body: any) => {
    await api.updateVisitor(id, body);
    message.success('已更新');
    load();
  };

  const inSite = rows.filter((r) => r.status === 'IN').length;
  const pending = rows.filter((r) => r.status === 'PENDING').length;
  const overstay = rows.filter((r) => r.overstay).length;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon
        message="留宿必须审批"
        description="不留宿的访客登记后直接放行；要过夜的先进「待审批」，批准后才算合法留宿。超期未离开会进待办告警。" />

      <Row gutter={12}>
        <Col span={6}><Card size="small"><Statistic title="当前在园" value={inSite} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="待审批留宿" value={pending} valueStyle={{ color: pending ? '#fa8c16' : undefined }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="超期未离开" value={overstay} valueStyle={{ color: overstay ? '#cf1322' : undefined }} /></Card></Col>
        <Col span={6}>
          <Card size="small" styles={{ body: { display: 'flex', alignItems: 'center', height: '100%' } }}>
            <Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>登记访客</Button>
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Space wrap>
          <Input.Search style={{ width: 200 }} placeholder="访客姓名 / 编号" allowClear
            onSearch={(v) => setFilters((f) => ({ ...f, q: v }))} />
          <Select allowClear style={{ width: 130 }} placeholder={t('status')}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={['PENDING', 'APPROVED', 'IN', 'OUT', 'REJECTED'].map((s) => ({ value: s, label: labelOf(VISITOR_STATUS_LABEL, s, lang) }))} />
          <Button type={filters.overnight ? 'primary' : 'default'}
            onClick={() => setFilters((f) => ({ ...f, overnight: f.overnight ? undefined : 'true' }))}>
            只看留宿
          </Button>
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" loading={loading} dataSource={rows}
          pagination={{ pageSize: 20, size: 'small', showTotal: (n) => `共 ${n} 条` }}
          columns={[
            { title: '编号', dataIndex: 'code', width: 100 },
            { title: '访客', dataIndex: 'name', width: 150,
              render: (v, r: any) => <span>{v}<br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.idNumber}</span></span> },
            { title: t('phone'), dataIndex: 'phone', width: 150 },
            { title: '被访人', width: 170, render: (_, r: any) =>
                <span>{r.host.name}<br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.host.department}</span></span> },
            { title: t('location'), dataIndex: 'location', width: 120 },
            { title: t('purpose'), dataIndex: 'purpose', width: 130 },
            { title: t('overnight'), dataIndex: 'overnight', width: 80, align: 'center',
              render: (v) => (v ? <Tag color="purple">留宿</Tag> : <Tag>当日</Tag>) },
            { title: '进入', dataIndex: 'checkInAt', width: 110, render: (v) => new Date(v).toLocaleDateString() },
            { title: t('expectedOut'), dataIndex: 'expectedOutAt', width: 110,
              render: (v, r: any) => v
                ? <span style={{ color: r.overstay ? '#cf1322' : undefined }}>{new Date(v).toLocaleDateString()}</span>
                : '—' },
            { title: t('status'), dataIndex: 'status', width: 100,
              render: (v, r: any) => <Tag color={
                v === 'IN' ? 'blue' : v === 'PENDING' ? 'orange' : v === 'REJECTED' ? 'red' : v === 'APPROVED' ? 'green' : 'default'
              }>{labelOf(VISITOR_STATUS_LABEL, v, lang)}{r.overstay && ' · 超期'}</Tag> },
            {
              title: '', width: 170, render: (_, r: any) => (
                <Space size={4}>
                  {r.status === 'PENDING' && <>
                    <Button size="small" type="primary" onClick={() => update(r.id, { status: 'APPROVED', approvedBy: '宿舍主管' })}>{t('approve')}</Button>
                    <Button size="small" danger onClick={() => update(r.id, { status: 'REJECTED' })}>{t('reject')}</Button>
                  </>}
                  {r.status === 'APPROVED' && <Button size="small" onClick={() => update(r.id, { status: 'IN' })}>登记进入</Button>}
                  {r.status === 'IN' && <Button size="small" onClick={() => update(r.id, { status: 'OUT' })}>登记离开</Button>}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={creating} title="登记访客" onCancel={() => setCreating(false)}
        onOk={async () => {
          const v = await form.validateFields();
          const opt = personOptions.find((o) => o.value === v.hostPersonId);
          await api.createVisitor({ ...v, roomId: opt?.roomId, expectedOutAt: v.expectedOutAt?.toISOString() });
          message.success(v.overnight ? '已提交，留宿需审批' : '已登记放行');
          setCreating(false); load();
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ overnight: false, registeredBy: '门岗', expectedOutAt: dayjs().add(1, 'day') }}>
          <Form.Item name="name" label="访客姓名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="idNumber" label={t('idNumber')}><Input /></Form.Item>
          <Form.Item name="phone" label={t('phone')}><Input /></Form.Item>
          <Form.Item name="nationalityId" label={t('nationality')}>
            <Select allowClear options={meta.nationalities.map((n: any) => ({ value: n.id, label: n.nameZh }))} />
          </Form.Item>
          <Form.Item name="hostPersonId" label="被访人" rules={[{ required: true }]}>
            <Select showSearch filterOption={false} onSearch={searchPersons} options={personOptions}
              placeholder="输入姓名或工号搜索" />
          </Form.Item>
          <Form.Item name="purpose" label={t('purpose')}><Input /></Form.Item>
          <Form.Item name="overnight" label={t('overnight')} valuePropName="checked"
            extra="留宿需要宿舍主管审批后才能进入">
            <Switch />
          </Form.Item>
          <Form.Item name="expectedOutAt" label={t('expectedOut')}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="registeredBy" label="登记人"><Input /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
