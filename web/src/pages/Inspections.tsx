import { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Space, Select, Button, App, Modal, Form, Drawer,
  Row, Col, Statistic, Alert, InputNumber, Input, Progress, Segmented,
} from 'antd';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { useMeta, INSPECTION_TYPE_LABEL, labelOf } from '../meta';

/**
 * 查寝与检查。
 *  - 夜间查寝：系统自动把该楼层当前在住的人拉成点名清单，宿管逐个点「在位 / 未归」
 *  - 卫生 / 安全检查：按房间打分记问题
 * 未归记录可以直接转成违规。
 */
export default function Inspections() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message } = App.useApp();

  const [rows, setRows] = useState<any[]>([]);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [tree, setTree] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.inspections(filters).then(setRows).finally(() => setLoading(false));
  };
  useEffect(load, [JSON.stringify(filters)]);
  useEffect(() => { api.tree().then(setTree); }, []);

  const openDetail = (id: number) => api.inspection(id).then(setDetail);

  const setItem = async (itemId: number, body: any) => {
    await api.updateInspectionItem(itemId, body);
    if (detail) openDetail(detail.id);
  };

  const doneCount = rows.filter((r) => r.status === 'DONE').length;
  const absentTotal = rows.reduce((s, r) => s + (r.absentCount ?? 0), 0);
  const issueTotal = rows.reduce((s, r) => s + (r.issueCount ?? 0), 0);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Row gutter={12}>
        <Col span={6}><Card size="small"><Statistic title="检查记录" value={rows.length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="已完成" value={doneCount} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="累计未归人次" value={absentTotal} valueStyle={{ color: absentTotal ? '#fa8c16' : undefined }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="发现问题" value={issueTotal} /></Card></Col>
      </Row>

      <Card size="small">
        <Space wrap>
          <Select allowClear style={{ width: 150 }} placeholder="检查类型"
            onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
            options={meta.inspectionTypes.map((s: string) => ({ value: s, label: labelOf(INSPECTION_TYPE_LABEL, s, lang) }))} />
          <Select allowClear style={{ width: 130 }} placeholder={t('status')}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={[{ value: 'PLANNED', label: '计划中' }, { value: 'DOING', label: '进行中' }, { value: 'DONE', label: '已完成' }]} />
          <Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>发起检查</Button>
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" loading={loading} dataSource={rows}
          pagination={{ pageSize: 20, size: 'small' }}
          columns={[
            { title: '编号', dataIndex: 'code', width: 110, render: (v, r: any) => <a onClick={() => openDetail(r.id)}>{v}</a> },
            { title: '类型', dataIndex: 'type', width: 120,
              render: (v) => <Tag color={v === 'NIGHT_ROLL_CALL' ? 'blue' : v === 'SAFETY' ? 'red' : 'green'}>
                {labelOf(INSPECTION_TYPE_LABEL, v, lang)}</Tag> },
            { title: t('location'), dataIndex: 'location', width: 140 },
            { title: '计划时间', dataIndex: 'plannedAt', width: 120, render: (v) => new Date(v).toLocaleDateString() },
            { title: '检查人', dataIndex: 'inspector', width: 110 },
            { title: t('status'), dataIndex: 'status', width: 90,
              render: (v) => <Tag color={v === 'DONE' ? 'green' : v === 'DOING' ? 'blue' : 'default'}>
                {v === 'DONE' ? '已完成' : v === 'DOING' ? '进行中' : '计划中'}</Tag> },
            { title: '点名', width: 150, render: (_, r: any) =>
                r.type === 'NIGHT_ROLL_CALL' && r.itemCount > 0
                  ? <Space size={4}>
                      <Tag color="green">在位 {r.presentCount}</Tag>
                      {r.absentCount > 0 && <Tag color="orange">未归 {r.absentCount}</Tag>}
                    </Space>
                  : '—' },
            { title: t('score'), dataIndex: 'score', width: 110,
              render: (v) => (v !== null && v !== undefined
                ? <Progress percent={v} size="small" status={v < 75 ? 'exception' : 'normal'} />
                : '—') },
            { title: t('issues'), dataIndex: 'issueCount', width: 80, align: 'right',
              render: (v) => (v ? <Tag color="orange">{v}</Tag> : '—') },
          ]}
        />
      </Card>

      <Drawer open={!!detail} width={640} onClose={() => setDetail(null)}
        title={detail ? `${detail.code} · ${labelOf(INSPECTION_TYPE_LABEL, detail.type, lang)} · ${detail.location}` : ''}>
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {detail.status !== 'DONE' && (
              <Alert type="info" showIcon message="逐条记录，完成后点「结束检查」" />
            )}
            <Space>
              <Button type="primary" size="small" disabled={detail.status === 'DONE'}
                onClick={async () => {
                  await api.updateInspection(detail.id, { status: 'DONE' });
                  message.success('检查已结束'); openDetail(detail.id); load();
                }}>结束检查</Button>
              <span style={{ color: '#8c8c8c', fontSize: 12 }}>检查人：{detail.inspector}</span>
            </Space>

            {detail.type === 'NIGHT_ROLL_CALL' ? (
              <Table
                size="small" rowKey="id" pagination={{ pageSize: 25, size: 'small' }} dataSource={detail.items}
                columns={[
                  { title: t('room'), dataIndex: 'roomCode', width: 90 },
                  { title: t('name'), width: 160, render: (_, r: any) => r.person
                      ? <span>{r.person.name}<br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.person.employeeNo}</span></span> : '—' },
                  { title: t('department'), dataIndex: ['person', 'department'], width: 120 },
                  {
                    title: '点名', width: 160,
                    render: (_, r: any) => (
                      <Segmented
                        size="small" value={r.present === null ? '未点' : r.present ? '在位' : '未归'}
                        options={['未点', '在位', '未归']}
                        onChange={(v) => setItem(r.id, { present: v === '未点' ? null : v === '在位' })}
                      />
                    ),
                  },
                ]}
              />
            ) : (
              <Table
                size="small" rowKey="id" pagination={{ pageSize: 25, size: 'small' }} dataSource={detail.items}
                columns={[
                  { title: t('room'), dataIndex: 'roomCode', width: 100 },
                  {
                    title: t('score'), width: 120,
                    render: (_, r: any) => (
                      <InputNumber size="small" min={0} max={100} value={r.score}
                        onChange={(v) => v !== null && setItem(r.id, { score: v })} />
                    ),
                  },
                  {
                    title: t('issues'),
                    render: (_, r: any) => (
                      <Input size="small" defaultValue={r.issues ?? ''} placeholder="发现的问题"
                        onBlur={(e) => e.target.value !== (r.issues ?? '') && setItem(r.id, { issues: e.target.value })} />
                    ),
                  },
                ]}
              />
            )}
          </Space>
        )}
      </Drawer>

      <Modal
        open={creating} title="发起检查" onCancel={() => setCreating(false)}
        onOk={async () => {
          const v = await form.validateFields();
          const r = await api.createInspection({ ...v, scopeType: 'FLOOR', scopeId: v.scopeId });
          message.success(`已发起，生成 ${r.itemCount} 条检查项`);
          setCreating(false); load(); openDetail(r.id);
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'NIGHT_ROLL_CALL', inspector: '楼栋宿管' }}>
          <Form.Item name="type" label="检查类型" rules={[{ required: true }]}
            extra="夜间查寝会自动把该层在住人员拉成点名清单">
            <Select options={meta.inspectionTypes.map((s: string) => ({ value: s, label: labelOf(INSPECTION_TYPE_LABEL, s, lang) }))} />
          </Form.Item>
          <Form.Item name="scopeId" label="楼层" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label"
              options={tree.flatMap((b) => b.floors.map((f: any) => ({ value: f.id, label: `${b.code}栋 ${f.level}层（${f.stats.occupied + f.stats.held} 人在住）` })))} />
          </Form.Item>
          <Form.Item name="inspector" label="检查人"><Input /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
