import { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Space, Select, Input, Button, Drawer, Descriptions, App,
  Modal, Form, InputNumber, Row, Col, Statistic, Switch, Alert,
} from 'antd';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { useMeta, WO_STATUS_LABEL, WO_STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR, labelOf } from '../meta';

/**
 * 报修工单。关键点：
 *  - 每个类别有自己的时限（SLA），超时会红标并进「待办告警」
 *  - 影响住宿的工单（漏水、断电）会自动把房间置为维修，防止继续往里排人；
 *    工单完成后房间自动转「待清洁」
 */
export default function WorkOrders() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message } = App.useApp();

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [tree, setTree] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.workOrders({ page, pageSize: 20, ...filters })
      .then((r) => { setRows(r.rows); setTotal(r.total); })
      .finally(() => setLoading(false));
  };
  useEffect(load, [page, JSON.stringify(filters)]);
  useEffect(() => { api.tree().then(setTree); }, []);

  const setF = (k: string, v: any) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const openCount = rows.filter((r) => ['NEW', 'ASSIGNED', 'IN_PROGRESS'].includes(r.status)).length;
  const overdueCount = rows.filter((r) => r.overdue).length;

  const advance = async (r: any, status: string) => {
    await api.updateWorkOrder(r.id, { status });
    message.success('已更新');
    load();
    if (detail?.id === r.id) setDetail({ ...detail, status });
  };

  const loadRooms = async (floorId: number) => {
    const f = await api.floor(floorId);
    setRooms(f.rooms);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Row gutter={12}>
        <Col span={6}><Card size="small"><Statistic title="本页未完成" value={openCount} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="本页已超时" value={overdueCount} valueStyle={{ color: overdueCount ? '#cf1322' : undefined }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="工单总数" value={total} /></Card></Col>
        <Col span={6}>
          <Card size="small" styles={{ body: { display: 'flex', alignItems: 'center', height: '100%' } }}>
            <Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>{t('create')}{t('workOrder')}</Button>
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Space wrap>
          <Input.Search style={{ width: 220 }} placeholder="单号 / 标题" allowClear
            onSearch={(v) => setF('q', v)} onChange={(e) => !e.target.value && setF('q', undefined)} />
          <Select allowClear style={{ width: 140 }} placeholder={t('status')}
            onChange={(v) => setF('status', v)}
            options={meta.workOrderStatuses.map((s: string) => ({ value: s, label: labelOf(WO_STATUS_LABEL, s, lang) }))} />
          <Select allowClear style={{ width: 120 }} placeholder={t('priority')}
            onChange={(v) => setF('priority', v)}
            options={meta.priorities.map((s: string) => ({ value: s, label: labelOf(PRIORITY_LABEL, s, lang) }))} />
          <Select allowClear style={{ width: 160 }} placeholder={t('category')}
            onChange={(v) => setF('categoryId', v)}
            options={meta.workOrderCategories.map((c: any) => ({ value: c.id, label: `${c.nameZh}（${c.slaHours}h）` }))} />
          <Button onClick={() => setF('open', filters.open ? undefined : 'true')} type={filters.open ? 'primary' : 'default'}>
            只看未完成
          </Button>
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" loading={loading} dataSource={rows}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage, size: 'small', showTotal: (n) => `共 ${n} 条` }}
          rowClassName={(r: any) => (r.overdue ? 'row-danger' : '')}
          columns={[
            { title: '单号', dataIndex: 'code', width: 110, render: (v, r: any) => <a onClick={() => setDetail(r)}>{v}</a> },
            { title: t('category'), dataIndex: 'category', width: 110 },
            { title: '标题', dataIndex: 'title', ellipsis: true },
            { title: t('location'), dataIndex: 'location', width: 170 },
            { title: t('priority'), dataIndex: 'priority', width: 80,
              render: (v) => <Tag color={PRIORITY_COLOR[v]}>{labelOf(PRIORITY_LABEL, v, lang)}</Tag> },
            { title: t('status'), dataIndex: 'status', width: 100,
              render: (v) => <Tag color={WO_STATUS_COLOR[v]}>{labelOf(WO_STATUS_LABEL, v, lang)}</Tag> },
            { title: t('sla'), width: 110, render: (_, r: any) =>
                r.overdue
                  ? <Tag color="red">超时 {Math.round((Date.now() - new Date(r.deadline).getTime()) / 36e5)}h</Tag>
                  : r.hoursUsed !== null ? <span style={{ color: '#8c8c8c' }}>{r.hoursUsed}h / {r.slaHours}h</span>
                  : <span style={{ color: '#8c8c8c' }}>限 {r.slaHours}h</span> },
            { title: t('blocksOccupancy'), dataIndex: 'blocksOccupancy', width: 90, align: 'center',
              render: (v) => (v ? <Tag color="red">是</Tag> : '') },
            { title: t('assignedTo'), dataIndex: 'assignedTo', width: 110 },
            { title: '报修时间', dataIndex: 'reportedAt', width: 110, render: (v) => new Date(v).toLocaleDateString() },
            {
              title: '', width: 140, render: (_, r: any) => (
                <Space size={4}>
                  {r.status === 'NEW' && <Button size="small" onClick={() => advance(r, 'ASSIGNED')}>派工</Button>}
                  {r.status === 'ASSIGNED' && <Button size="small" onClick={() => advance(r, 'IN_PROGRESS')}>开工</Button>}
                  {r.status === 'IN_PROGRESS' && <Button size="small" type="primary" onClick={() => advance(r, 'DONE')}>完成</Button>}
                  {r.status === 'DONE' && <Button size="small" onClick={() => advance(r, 'CLOSED')}>关闭</Button>}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Drawer open={!!detail} width={560} onClose={() => setDetail(null)} title={detail?.code}>
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {detail.overdue && <Alert type="error" showIcon message={`已超出 ${detail.category} 类别的 ${detail.slaHours} 小时时限`} />}
            {detail.blocksOccupancy && (
              <Alert type="warning" showIcon
                message="该工单标记为「影响住宿」"
                description="房间已自动置为维修状态，不会再往里排人；工单完成后自动转为待清洁。" />
            )}
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="标题" span={2}>{detail.title}</Descriptions.Item>
              <Descriptions.Item label={t('category')}>{detail.category}</Descriptions.Item>
              <Descriptions.Item label={t('priority')}>
                <Tag color={PRIORITY_COLOR[detail.priority]}>{labelOf(PRIORITY_LABEL, detail.priority, lang)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('location')} span={2}>{detail.location}</Descriptions.Item>
              <Descriptions.Item label={t('reporter')}>{detail.reporter}</Descriptions.Item>
              <Descriptions.Item label={t('assignedTo')}>{detail.assignedTo ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="报修时间">{new Date(detail.reportedAt).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="应完成">{new Date(detail.deadline).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="开工">{detail.startedAt ? new Date(detail.startedAt).toLocaleString() : '—'}</Descriptions.Item>
              <Descriptions.Item label="完成">{detail.finishedAt ? new Date(detail.finishedAt).toLocaleString() : '—'}</Descriptions.Item>
              <Descriptions.Item label={t('cost')} span={2}>¥ {detail.cost}</Descriptions.Item>
              <Descriptions.Item label="描述" span={2}>{detail.description}</Descriptions.Item>
            </Descriptions>
            <Space>
              <Select size="small" style={{ width: 130 }} value={detail.status}
                onChange={(v) => advance(detail, v)}
                options={meta.workOrderStatuses.map((s: string) => ({ value: s, label: labelOf(WO_STATUS_LABEL, s, lang) }))} />
              <Input.Search size="small" placeholder="指派给" defaultValue={detail.assignedTo ?? ''} enterButton="指派"
                onSearch={async (v) => { await api.updateWorkOrder(detail.id, { assignedTo: v }); message.success('已指派'); load(); }} />
            </Space>
          </Space>
        )}
      </Drawer>

      <Modal
        open={creating} title={`${t('create')}${t('workOrder')}`} onCancel={() => setCreating(false)}
        onOk={async () => {
          const v = await form.validateFields();
          await api.createWorkOrder(v);
          message.success('已创建');
          setCreating(false); load();
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ priority: 'NORMAL', scopeType: 'ROOM' }}>
          <Form.Item name="categoryId" label={t('category')} rules={[{ required: true }]}>
            <Select options={meta.workOrderCategories.map((c: any) => ({ value: c.id, label: `${c.nameZh}（时限 ${c.slaHours}h）` }))} />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="floorId" label={`${t('building')} / ${t('floor')}`}>
            <Select
              showSearch optionFilterProp="label"
              onChange={(v) => { loadRooms(v); form.setFieldValue('scopeId', undefined); }}
              options={tree.flatMap((b) => b.floors.map((f: any) => ({ value: f.id, label: `${b.code}栋 ${f.level}层` })))}
            />
          </Form.Item>
          <Form.Item name="scopeId" label={t('room')} rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label"
              options={rooms.map((r: any) => ({ value: r.id, label: `${r.code} · ${r.roomType.nameZh}` }))} />
          </Form.Item>
          <Form.Item name="priority" label={t('priority')}>
            <Select options={meta.priorities.map((s: string) => ({ value: s, label: labelOf(PRIORITY_LABEL, s, lang) }))} />
          </Form.Item>
          <Form.Item name="blocksOccupancy" label={t('blocksOccupancy')} valuePropName="checked"
            extra="勾选后房间会自动置为维修，不再往里排人">
            <Switch />
          </Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
