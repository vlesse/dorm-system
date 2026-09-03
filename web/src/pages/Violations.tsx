import { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Space, Select, Button, App, Modal, Form, Input, InputNumber,
  Row, Col, Statistic, Alert, Tabs, DatePicker,
} from 'antd';
import dayjs from 'dayjs';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { useMeta, SEVERITY_LABEL, SEVERITY_COLOR, VIOLATION_STATUS_LABEL, labelOf } from '../meta';

/**
 * 违规记录。
 * 在印尼园区，私拉电线 / 大功率电器 / 明火是真实的火灾来源，
 * 所以违规类型自带严重程度、扣分和罚款，积分累计超阈值会进「待办告警」。
 */
export default function Violations() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message } = App.useApp();

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [ranking, setRanking] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [personOptions, setPersonOptions] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.violations({ page, pageSize: 20, ...filters })
      .then((r) => { setRows(r.rows); setTotal(r.total); })
      .finally(() => setLoading(false));
  };
  useEffect(load, [page, JSON.stringify(filters)]);
  useEffect(() => { api.violationRanking().then(setRanking); }, []);

  const setF = (k: string, v: any) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const searchPersons = async (q: string) => {
    if (!q) return;
    const r = await api.persons({ q, pageSize: 20, housed: 'true' });
    setPersonOptions(r.rows.map((p: any) => ({
      value: p.id,
      label: `${p.name}（${p.employeeNo}）${p.accommodation ? ' · ' + p.accommodation.roomCode : ''}`,
      roomId: p.accommodation?.roomId,
    })));
  };

  const critical = rows.filter((r) => r.severity === 'CRITICAL').length;
  const openCount = rows.filter((r) => r.status === 'OPEN').length;

  const list = (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select allowClear style={{ width: 160 }} placeholder="违规类型"
            onChange={(v) => setF('typeId', v)}
            options={meta.violationTypes.map((v: any) => ({ value: v.id, label: v.nameZh }))} />
          <Select allowClear style={{ width: 120 }} placeholder={t('severity')}
            onChange={(v) => setF('severity', v)}
            options={meta.severities.map((s: string) => ({ value: s, label: labelOf(SEVERITY_LABEL, s, lang) }))} />
          <Select allowClear style={{ width: 120 }} placeholder={t('status')}
            onChange={(v) => setF('status', v)}
            options={['OPEN', 'HANDLED', 'APPEALED', 'CLOSED'].map((s) => ({ value: s, label: labelOf(VIOLATION_STATUS_LABEL, s, lang) }))} />
          <Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>登记违规</Button>
        </Space>
      </Card>
      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" loading={loading} dataSource={rows}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage, size: 'small', showTotal: (n) => `共 ${n} 条` }}
          columns={[
            { title: '编号', dataIndex: 'code', width: 110 },
            { title: '时间', dataIndex: 'occurredAt', width: 100, render: (v) => new Date(v).toLocaleDateString() },
            { title: '违规类型', dataIndex: 'type', width: 150,
              render: (v, r: any) => <Space size={4}><span>{v}</span>
                <Tag color={SEVERITY_COLOR[r.severity]}>{labelOf(SEVERITY_LABEL, r.severity, lang)}</Tag></Space> },
            { title: t('name'), width: 160, render: (_, r: any) => r.person
                ? <span>{r.person.name} <Tag color={r.person.nationalityColor}>{r.person.nationalityId}</Tag>
                    <br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.person.employeeNo}</span></span>
                : '—' },
            { title: t('department'), dataIndex: ['person', 'department'], width: 120 },
            { title: t('location'), dataIndex: 'location', width: 120 },
            { title: t('points'), dataIndex: 'points', width: 70, align: 'right',
              render: (v) => <Tag color={v >= 6 ? 'red' : v >= 3 ? 'orange' : 'default'}>{v}</Tag> },
            { title: t('fine'), dataIndex: 'fine', width: 80, align: 'right', render: (v) => (v ? `¥${v}` : '—') },
            { title: t('status'), dataIndex: 'status', width: 100,
              render: (v, r: any) => (
                <Select size="small" variant="borderless" value={v} style={{ width: 96 }}
                  onChange={async (nv) => { await api.updateViolation(r.id, { status: nv }); message.success('已更新'); load(); }}
                  options={['OPEN', 'HANDLED', 'APPEALED', 'CLOSED'].map((s) => ({ value: s, label: labelOf(VIOLATION_STATUS_LABEL, s, lang) }))} />
              ) },
            { title: '记录人', dataIndex: 'recordedBy', width: 100 },
          ]}
        />
      </Card>
    </>
  );

  const rank = (
    <Card size="small" styles={{ body: { padding: 0 } }}>
      <Alert type="warning" showIcon style={{ margin: 12 }}
        message={`累计扣分达到 ${meta.settings['violation.pointsThreshold'] ?? 10} 分会进入待办告警`}
        description="阈值在「设置 → 阈值」里改。积分只统计未关闭的记录。" />
      <Table
        size="small" rowKey="personId" dataSource={ranking} pagination={{ pageSize: 20, size: 'small' }}
        columns={[
          { title: '排名', width: 60, render: (_, __, i) => i + 1 },
          { title: t('name'), dataIndex: 'name', width: 150 },
          { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
          { title: t('department'), dataIndex: 'department', width: 130 },
          { title: t('room'), dataIndex: 'roomCode', width: 110 },
          { title: '违规次数', dataIndex: 'count', width: 90, align: 'right' },
          { title: '累计扣分', dataIndex: 'points', width: 90, align: 'right',
            render: (v: number) => <Tag color={v >= 10 ? 'red' : v >= 6 ? 'orange' : 'default'}>{v}</Tag> },
          { title: '累计罚款', dataIndex: 'fine', width: 100, align: 'right', render: (v) => `¥${v}` },
        ]}
      />
    </Card>
  );

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Row gutter={12}>
        <Col span={8}><Card size="small"><Statistic title="本页待处理" value={openCount} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="本页重大违规" value={critical} valueStyle={{ color: critical ? '#cf1322' : undefined }} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="记录总数" value={total} /></Card></Col>
      </Row>

      <Tabs items={[
        { key: 'list', label: '违规记录', children: list },
        { key: 'rank', label: t('ranking'), children: rank },
      ]} />

      <Modal
        open={creating} title="登记违规" onCancel={() => setCreating(false)}
        onOk={async () => {
          const v = await form.validateFields();
          const opt = personOptions.find((o) => o.value === v.personId);
          await api.createViolation({ ...v, roomId: opt?.roomId, occurredAt: v.occurredAt?.toISOString() });
          message.success('已登记'); setCreating(false); load();
          api.violationRanking().then(setRanking);
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ occurredAt: dayjs(), recordedBy: '楼栋宿管' }}>
          <Form.Item name="typeId" label="违规类型" rules={[{ required: true }]}>
            <Select
              onChange={(v) => {
                const t2 = meta.violationTypes.find((x: any) => x.id === v);
                form.setFieldsValue({ points: t2?.defaultPoints, fine: t2?.defaultFine });
              }}
              options={meta.violationTypes.map((v: any) => ({
                value: v.id,
                label: `${v.nameZh}（${labelOf(SEVERITY_LABEL, v.severity, lang)} · 扣${v.defaultPoints}分）`,
              }))} />
          </Form.Item>
          <Form.Item name="personId" label={t('name')} rules={[{ required: true }]}>
            <Select showSearch filterOption={false} onSearch={searchPersons} options={personOptions}
              placeholder="输入姓名或工号搜索" />
          </Form.Item>
          <Form.Item name="occurredAt" label="发生时间"><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="points" label={t('points')}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
            <Col span={12}><Form.Item name="fine" label={t('fine')}><InputNumber style={{ width: '100%' }} min={0} addonBefore="¥" /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="情况说明"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="recordedBy" label="记录人"><Input /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
