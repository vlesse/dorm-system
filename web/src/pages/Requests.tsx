import { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Space, Select, Button, App, Modal, Form, Input,
  Row, Col, Statistic, Alert,
} from 'antd';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { useMeta, REQUEST_TYPE_LABEL, REQUEST_STATUS_LABEL, labelOf } from '../meta';

/**
 * 申请与审批。
 * 实际运营里，调宿、夫妻房、退宿、访客留宿、加床都不是宿管一个人说了算，
 * 要走一遍审批。批准之后再由宿管去床位图上执行。
 */
export default function Requests() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message } = App.useApp();

  const [rows, setRows] = useState<any[]>([]);
  const [filters, setFilters] = useState<Record<string, any>>({ status: 'PENDING' });
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [personOptions, setPersonOptions] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.requests(filters).then(setRows).finally(() => setLoading(false));
  };
  useEffect(load, [JSON.stringify(filters)]);

  const searchPersons = async (q: string) => {
    if (!q) return;
    const r = await api.persons({ q, pageSize: 20 });
    setPersonOptions(r.rows.map((p: any) => ({
      value: p.id,
      label: `${p.name}（${p.employeeNo}）${p.accommodation ? ' · ' + p.accommodation.roomCode : ' · 未安排'}`,
    })));
  };

  const decide = async (r: any, status: string) => {
    await api.updateRequest(r.id, { status, approvedBy: '宿舍主管' });
    message.success(status === 'APPROVED' ? '已批准' : '已驳回');
    load();
  };

  const pending = rows.filter((r) => r.status === 'PENDING');
  const longest = pending.reduce((m, r) =>
    Math.max(m, Math.round((Date.now() - new Date(r.submittedAt).getTime()) / 86400000)), 0);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon
        message="批准 ≠ 已执行"
        description="审批通过后，宿管还要到「床位图 / 人员」里实际做分配或调宿。这样审批和执行分开，责任清楚。" />

      <Row gutter={12}>
        <Col span={8}><Card size="small"><Statistic title="待审批" value={pending.length} valueStyle={{ color: pending.length ? '#fa8c16' : undefined }} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="最久等待" value={longest} suffix="天" /></Card></Col>
        <Col span={8}>
          <Card size="small" styles={{ body: { display: 'flex', alignItems: 'center', height: '100%' } }}>
            <Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>代提申请</Button>
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Space wrap>
          <Select allowClear style={{ width: 150 }} placeholder={t('status')} value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={['PENDING', 'APPROVED', 'REJECTED', 'DONE', 'CANCELLED'].map((s) => ({ value: s, label: labelOf(REQUEST_STATUS_LABEL, s, lang) }))} />
          <Select allowClear style={{ width: 160 }} placeholder="申请类型"
            onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
            options={meta.requestTypes.map((s: string) => ({ value: s, label: labelOf(REQUEST_TYPE_LABEL, s, lang) }))} />
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" loading={loading} dataSource={rows}
          pagination={{ pageSize: 20, size: 'small', showTotal: (n) => `共 ${n} 条` }}
          columns={[
            { title: '单号', dataIndex: 'code', width: 110 },
            { title: '类型', dataIndex: 'type', width: 130,
              render: (v) => <Tag color={v === 'COUPLE_ROOM' ? 'magenta' : v === 'CHECKOUT' ? 'red' : 'blue'}>
                {labelOf(REQUEST_TYPE_LABEL, v, lang)}</Tag> },
            { title: t('name'), width: 170, render: (_, r: any) =>
                <span>{r.person.name} <Tag color={r.person.nationalityColor}>{r.person.nationalityId}</Tag>
                  <br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.person.employeeNo}</span></span> },
            { title: t('department'), dataIndex: ['person', 'department'], width: 120 },
            { title: t('positionLevel'), dataIndex: ['person', 'positionLevel'], width: 90 },
            { title: '当前房间', dataIndex: ['person', 'currentRoom'], width: 100,
              render: (v) => v ?? <Tag color="orange">未安排</Tag> },
            { title: t('reason'), dataIndex: 'reason', ellipsis: true },
            { title: '提交', dataIndex: 'submittedAt', width: 100,
              render: (v) => <span>{new Date(v).toLocaleDateString()}<br />
                <span style={{ fontSize: 11, color: '#8c8c8c' }}>
                  等待 {Math.round((Date.now() - new Date(v).getTime()) / 86400000)} 天</span></span> },
            { title: t('status'), dataIndex: 'status', width: 90,
              render: (v) => <Tag color={v === 'PENDING' ? 'orange' : v === 'APPROVED' ? 'green' : v === 'REJECTED' ? 'red' : 'default'}>
                {labelOf(REQUEST_STATUS_LABEL, v, lang)}</Tag> },
            {
              title: '', width: 150, render: (_, r: any) =>
                r.status === 'PENDING' ? (
                  <Space size={4}>
                    <Button size="small" type="primary" onClick={() => decide(r, 'APPROVED')}>{t('approve')}</Button>
                    <Button size="small" danger onClick={() => decide(r, 'REJECTED')}>{t('reject')}</Button>
                  </Space>
                ) : r.status === 'APPROVED' ? (
                  <Button size="small" onClick={() => decide(r, 'DONE')}>标记已执行</Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <Modal
        open={creating} title="代提申请" onCancel={() => setCreating(false)}
        onOk={async () => {
          const v = await form.validateFields();
          await api.createRequest(v);
          message.success('已提交'); setCreating(false); load();
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'TRANSFER', submittedBy: '宿管代提' }}>
          <Form.Item name="type" label="申请类型" rules={[{ required: true }]}>
            <Select options={meta.requestTypes.map((s: string) => ({ value: s, label: labelOf(REQUEST_TYPE_LABEL, s, lang) }))} />
          </Form.Item>
          <Form.Item name="personId" label={t('name')} rules={[{ required: true }]}>
            <Select showSearch filterOption={false} onSearch={searchPersons} options={personOptions}
              placeholder="输入姓名或工号搜索" />
          </Form.Item>
          <Form.Item name="reason" label={t('reason')} rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="submittedBy" label="提交人"><Input /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
