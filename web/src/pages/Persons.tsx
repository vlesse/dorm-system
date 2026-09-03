import { useEffect, useState } from 'react';
import {
  Card, Table, Input, Select, Space, Tag, Button, Drawer, Descriptions, App,
  Typography, Tabs, Switch, Modal, Form, DatePicker, Row, Col, Alert, Statistic,
} from 'antd';
import dayjs from 'dayjs';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import {
  EMPLOYMENT_LABEL, OCC_STATUS_LABEL, PERSON_TYPE_LABEL, REL_TYPE_LABEL,
  SEVERITY_LABEL, labelOf, useMeta,
} from '../meta';
import AssignDrawer from '../components/AssignDrawer';

export default function Persons() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message, modal } = App.useApp();

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [assignFor, setAssignFor] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [hostOptions, setHostOptions] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any>(null);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.persons({ q, page, pageSize: 20, ...filters }).then(setData).finally(() => setLoading(false));
  };
  useEffect(load, [q, page, JSON.stringify(filters)]);

  const openDetail = (id: number) => { setContacts(null); api.person(id).then(setDetail); };
  const setF = (k: string, v: any) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const searchHosts = async (kw: string) => {
    if (!kw) return;
    const r = await api.persons({ q: kw, personType: 'EMPLOYEE', pageSize: 20 });
    setHostOptions(r.rows.map((p: any) => ({ value: p.id, label: `${p.name}（${p.employeeNo}）` })));
  };

  const doCheckout = (personId: number) => {
    const run = async (settleItems: boolean) => {
      try {
        await api.checkout({ personId, reason: '人员详情页办理', settleItems });
        message.success('已退宿'); openDetail(personId); load();
      } catch (e: any) {
        if (e.status === 409 && e.body?.pendingItems) {
          modal.confirm({
            title: '还有未归还物品', width: 520,
            content: (
              <ul style={{ paddingLeft: 18 }}>
                {e.body.pendingItems.map((i: any) => <li key={i.id}>{i.name} × {i.quantity}（单价 ¥{i.price}）</li>)}
              </ul>
            ),
            okText: '已清点，继续退宿', cancelText: '先去清点', onOk: () => run(true),
          });
        } else message.error(e.message);
      }
    };
    run(false);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Card size="small">
        <Space wrap>
          <Input.Search style={{ width: 240 }} placeholder={t('search')} allowClear
            onSearch={(v) => { setPage(1); setQ(v); }} onChange={(e) => !e.target.value && setQ('')} />
          <Select allowClear style={{ width: 120 }} placeholder={t('personType')}
            onChange={(v) => setF('personType', v)}
            options={meta.personTypes.map((s: string) => ({ value: s, label: labelOf(PERSON_TYPE_LABEL, s, lang) }))} />
          <Select allowClear style={{ width: 120 }} placeholder={t('nationality')}
            onChange={(v) => setF('nationalityId', v)}
            options={meta.nationalities.map((n: any) => ({ value: n.id, label: n.nameZh }))} />
          <Select allowClear style={{ width: 145 }} placeholder={t('department')}
            onChange={(v) => setF('departmentId', v)}
            options={meta.departments.map((d: any) => ({ value: d.id, label: d.nameZh }))} />
          <Select allowClear style={{ width: 110 }} placeholder={t('positionLevel')}
            onChange={(v) => setF('positionLevelId', v)}
            options={meta.positionLevels.map((p: any) => ({ value: p.id, label: p.nameZh }))} />
          <Select allowClear style={{ width: 100 }} placeholder={t('shift')}
            onChange={(v) => setF('shiftId', v)}
            options={meta.shifts.map((s: any) => ({ value: s.id, label: s.nameZh }))} />
          <Select allowClear style={{ width: 110 }} placeholder={t('religion')}
            onChange={(v) => setF('religionId', v)}
            options={meta.religions.map((r: any) => ({ value: r.id, label: r.nameZh }))} />
          <Select allowClear style={{ width: 150 }} placeholder={t('contractor')}
            onChange={(v) => setF('contractorId', v)}
            options={meta.contractors.map((c: any) => ({ value: c.id, label: c.name }))} />
          <Select allowClear style={{ width: 110 }} placeholder={t('employmentStatus')}
            onChange={(v) => setF('employmentStatus', v)}
            options={meta.employmentStatuses.map((s: string) => ({ value: s, label: labelOf(EMPLOYMENT_LABEL, s, lang) }))} />
          <Select allowClear style={{ width: 130 }} placeholder={t('accommodation')}
            onChange={(v) => setF('housed', v)}
            options={[{ value: 'true', label: t('housed') }, { value: 'false', label: t('unhoused') }]} />
          <Select allowClear style={{ width: 130 }} placeholder="特殊需求"
            onChange={(v) => { setF('needsLowerBunk', v === 'bunk' ? 'true' : undefined); setF('needsGroundFloor', v === 'floor' ? 'true' : undefined); }}
            options={[{ value: 'bunk', label: t('lowerBunkOnly') }, { value: 'floor', label: t('needsGroundFloor') }]} />
          <Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>新建家属档案</Button>
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" loading={loading} dataSource={data.rows}
          scroll={{ x: 1500 }}
          pagination={{ current: page, total: data.total, pageSize: 20, onChange: setPage, showTotal: (n) => `共 ${n} 人`, size: 'small' }}
          columns={[
            { title: t('employeeNo'), dataIndex: 'employeeNo', width: 100, fixed: 'left' },
            { title: t('name'), dataIndex: 'name', width: 160, fixed: 'left',
              render: (v, r: any) => (
                <a onClick={() => openDetail(r.id)}>
                  {v} <Tag color={r.nationalityColor} style={{ marginInlineStart: 4 }}>{r.nationalityId}</Tag>
                  {r.personType !== 'EMPLOYEE' && <Tag color="magenta">{labelOf(PERSON_TYPE_LABEL, r.personType, lang)}</Tag>}
                </a>
              ) },
            { title: t('gender'), dataIndex: 'gender', width: 55, render: (v) => (v === 'MALE' ? t('male') : t('female')) },
            { title: t('age'), dataIndex: 'age', width: 55 },
            { title: t('department'), dataIndex: 'department', width: 125 },
            { title: t('positionLevel'), dataIndex: 'positionLevel', width: 85 },
            { title: t('shift'), dataIndex: 'shift', width: 75, render: (v, r: any) => v && <Tag color={r.shiftColor}>{v}</Tag> },
            { title: t('religion'), dataIndex: 'religion', width: 95,
              render: (v, r: any) => v && <span>{v}{r.hasDietaryRule && <Tag color="green" style={{ marginLeft: 2 }}>禁忌</Tag>}</span> },
            { title: '标记', width: 110, render: (_, r: any) => (
                <Space size={2} wrap>
                  {r.isSmoker && <Tag>烟</Tag>}
                  {r.needsLowerBunk && <Tag color="orange">下铺</Tag>}
                  {r.needsGroundFloor && <Tag color="red">低层</Tag>}
                </Space>
              ) },
            { title: t('contractor'), dataIndex: 'contractor', width: 165, ellipsis: true,
              render: (v, r: any) => <span style={{ color: r.contractorIsSelf ? undefined : '#d46b08' }}>{v}</span> },
            { title: t('idExpiry'), dataIndex: 'idExpiryInDays', width: 100,
              render: (v) => v === null ? '—'
                : <Tag color={v <= 0 ? 'red' : v <= 90 ? 'orange' : 'default'}>{v <= 0 ? '已过期' : `${v} 天`}</Tag> },
            { title: t('employmentStatus'), dataIndex: 'employmentStatus', width: 85,
              render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : v === 'RESIGNED' ? 'red' : 'purple'}>
                {labelOf(EMPLOYMENT_LABEL, v, lang)}</Tag> },
            { title: t('accommodation'), width: 200, render: (_, r: any) =>
                r.accommodation
                  ? <span>{r.accommodation.buildingCode}栋 {r.accommodation.roomCode} · {r.accommodation.bedLabel}
                      {r.accommodation.isCoupleRoom && <Tag color="magenta" style={{ marginLeft: 4 }}>夫妻房</Tag>}
                      {r.accommodation.status === 'HELD' && <Tag color="purple" style={{ marginLeft: 4 }}>{t('held')}</Tag>}</span>
                  : <Tag color="orange">{t('noBed')}</Tag> },
            { title: '', width: 80, fixed: 'right', render: (_, r: any) =>
                r.employmentStatus !== 'RESIGNED' && (
                  <Button size="small" type="link" onClick={() => setAssignFor(r.id)}>
                    {r.accommodation ? t('transfer') : t('assign')}
                  </Button>
                ) },
          ]}
        />
      </Card>

      <Drawer open={!!detail} width={760} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && (
          <Tabs
            items={[
              {
                key: 'base', label: '基本信息',
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {detail.idExpiryInDays !== null && detail.idExpiryInDays <= 90 && (
                      <Alert type={detail.idExpiryInDays <= 0 ? 'error' : 'warning'} showIcon
                        message={detail.idExpiryInDays <= 0
                          ? `证件已过期 ${-detail.idExpiryInDays} 天` : `证件 ${detail.idExpiryInDays} 天后到期`}
                        description="护照 / KITAS 过期意味着非法居留，要提前安排续签。" />
                    )}
                    <Descriptions size="small" column={2} bordered>
                      <Descriptions.Item label={t('employeeNo')}>{detail.employeeNo}</Descriptions.Item>
                      <Descriptions.Item label={t('personType')}>
                        <Tag color={detail.personType === 'EMPLOYEE' ? 'blue' : 'magenta'}>
                          {labelOf(PERSON_TYPE_LABEL, detail.personType, lang)}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label={t('gender')}>{detail.gender === 'MALE' ? t('male') : t('female')}</Descriptions.Item>
                      <Descriptions.Item label={t('age')}>{detail.age ?? '—'}</Descriptions.Item>
                      <Descriptions.Item label={t('nationality')}>
                        <Tag color={detail.nationalityColor}>{detail.nationalityName}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label={t('religion')}>
                        {detail.religion ?? '—'}{detail.hasDietaryRule && <Tag color="green" style={{ marginLeft: 4 }}>有饮食禁忌</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('idNumber')}>{detail.idType} {detail.idNumber}</Descriptions.Item>
                      <Descriptions.Item label={t('idExpiry')}>
                        {detail.idExpiryDate ? new Date(detail.idExpiryDate).toLocaleDateString() : '—'}
                        {detail.passportHeld && <Tag color="blue" style={{ marginLeft: 4 }}>公司代管</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('department')}>{detail.department ?? '—'}</Descriptions.Item>
                      <Descriptions.Item label={t('positionLevel')}>
                        {detail.positionLevel ?? '—'}
                        {detail.coupleRoomAllowed && <Tag color="magenta" style={{ marginLeft: 4 }}>可申请夫妻房</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('shift')}>{detail.shift ?? '—'}</Descriptions.Item>
                      <Descriptions.Item label={t('languages')}>{detail.languages.join(' / ') || '—'}</Descriptions.Item>
                      <Descriptions.Item label={t('phone')}>{detail.phone ?? '—'}</Descriptions.Item>
                      <Descriptions.Item label={t('emergencyContact')}>
                        {detail.emergencyContact ?? '—'} {detail.emergencyPhone}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('contractor')} span={2}>{detail.contractor ?? '—'}</Descriptions.Item>
                      <Descriptions.Item label="特殊需求" span={2}>
                        <Space size={12}>
                          <span>{t('smoker')}：<Switch size="small" checked={detail.isSmoker}
                            onChange={async (v) => { await api.updatePerson(detail.id, { isSmoker: v }); openDetail(detail.id); }} /></span>
                          <span>{t('lowerBunkOnly')}：<Switch size="small" checked={detail.needsLowerBunk}
                            onChange={async (v) => { await api.updatePerson(detail.id, { needsLowerBunk: v }); openDetail(detail.id); }} /></span>
                          <span>{t('needsGroundFloor')}：<Switch size="small" checked={detail.needsGroundFloor}
                            onChange={async (v) => { await api.updatePerson(detail.id, { needsGroundFloor: v }); openDetail(detail.id); }} /></span>
                        </Space>
                      </Descriptions.Item>
                      <Descriptions.Item label={t('leaveCycle')}>{detail.leaveCycleMonths ?? '—'} 个月</Descriptions.Item>
                      <Descriptions.Item label={t('nextLeave')}>
                        {detail.nextLeaveDue
                          ? <span>{new Date(detail.nextLeaveDue).toLocaleDateString()}{' '}
                              <Tag color={detail.leaveDueInDays <= 0 ? 'red' : detail.leaveDueInDays <= 30 ? 'orange' : 'default'}>
                                {detail.leaveDueInDays <= 0 ? `已超期 ${-detail.leaveDueInDays} 天` : `还剩 ${detail.leaveDueInDays} 天`}
                              </Tag></span>
                          : '—'}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('employmentStatus')} span={2}>
                        <Select size="small" style={{ width: 140 }} value={detail.employmentStatus}
                          onChange={async (v) => { await api.updatePerson(detail.id, { employmentStatus: v }); message.success('已更新'); openDetail(detail.id); load(); }}
                          options={meta.employmentStatuses.map((s: string) => ({ value: s, label: labelOf(EMPLOYMENT_LABEL, s, lang) }))} />
                      </Descriptions.Item>
                      <Descriptions.Item label={t('accommodation')} span={2}>
                        {detail.accommodation
                          ? `${detail.accommodation.buildingName} ${detail.accommodation.floorLevel}F ${detail.accommodation.roomCode} · ${detail.accommodation.bedLabel}（${detail.accommodation.roomType}）`
                          : t('noBed')}
                      </Descriptions.Item>
                      {detail.hostPerson && (
                        <Descriptions.Item label={t('hostPerson')} span={2}>
                          {detail.hostPerson.name}（{detail.hostPerson.employeeNo}）
                        </Descriptions.Item>
                      )}
                    </Descriptions>

                    <Space>
                      <Button type="primary" size="small" onClick={() => setAssignFor(detail.id)}>
                        {detail.accommodation ? t('transfer') : t('assign')}
                      </Button>
                      {detail.accommodation && <Button danger size="small" onClick={() => doCheckout(detail.id)}>{t('checkout')}</Button>}
                      <Button size="small" onClick={async () => {
                        const c = await api.contacts(detail.id, { scope: 'ROOM' });
                        setContacts(c);
                      }}>{t('contactTrace')}</Button>
                    </Space>

                    {contacts && (
                      <Card size="small" title={`${t('contacts')}（近 14 天同房间）`} styles={{ body: { padding: 0 } }}>
                        <Table size="small" rowKey="personId" pagination={{ pageSize: 8, size: 'small' }} dataSource={contacts.contacts}
                          locale={{ emptyText: '无同住接触者' }}
                          columns={[
                            { title: t('name'), dataIndex: 'name', width: 140 },
                            { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
                            { title: t('department'), dataIndex: 'department', width: 120 },
                            { title: t('room'), dataIndex: 'roomCode', width: 100 },
                            { title: t('bed'), dataIndex: 'bedLabel', width: 100 },
                          ]} />
                        <div style={{ padding: '6px 10px', fontSize: 11, color: '#8c8c8c' }}>
                          传染病隔离、事故调查用。时间区间模型天生支持这个查询。
                        </div>
                      </Card>
                    )}
                  </Space>
                ),
              },
              {
                key: 'family', label: `${t('nav_families')}（${detail.relationships.length}）`,
                children: (
                  <Table size="small" rowKey="id" pagination={false} dataSource={detail.relationships}
                    locale={{ emptyText: '未登记亲属关系' }}
                    columns={[
                      { title: '关系', dataIndex: 'type', width: 100,
                        render: (v) => <Tag>{labelOf(REL_TYPE_LABEL, v, lang)}</Tag> },
                      { title: '对方', width: 200, render: (_, r: any) =>
                          <span>{r.other.name}<br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.other.employeeNo}</span></span> },
                      { title: '类型', width: 110, render: (_, r: any) =>
                          <Tag color={r.other.personType === 'EMPLOYEE' ? 'blue' : 'magenta'}>
                            {labelOf(PERSON_TYPE_LABEL, r.other.personType, lang)}</Tag> },
                      { title: t('verified'), dataIndex: 'verified', width: 100,
                        render: (v) => v ? <Tag color="green">{t('verified')}</Tag> : <Tag color="orange">{t('unverified')}</Tag> },
                      { title: '备注', dataIndex: 'note', ellipsis: true },
                    ]} />
                ),
              },
              {
                key: 'history', label: t('history'),
                children: (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Table size="small" rowKey="id" pagination={false} dataSource={detail.history}
                      columns={[
                        { title: '位置', render: (_, r: any) => `${r.buildingName} ${r.floorLevel}F ${r.roomCode} · ${r.bedLabel}` },
                        { title: '区间', width: 180, render: (_, r: any) =>
                            `${new Date(r.checkInAt).toLocaleDateString()} → ${r.checkOutAt ? new Date(r.checkOutAt).toLocaleDateString() : '至今'}` },
                        { title: t('status'), dataIndex: 'status', width: 90,
                          render: (v) => <Tag>{labelOf(OCC_STATUS_LABEL, v, lang)}</Tag> },
                        { title: t('reason'), dataIndex: 'reason', ellipsis: true },
                      ]} />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      每次分配 / 调宿 / 退宿都会留下一条区间记录，不会覆盖历史。
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                key: 'items', label: `${t('items')} / ${t('deposit')}`,
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    <Row gutter={12}>
                      <Col span={8}><Card size="small"><Statistic title="已发放" value={detail.issuedItems.length} /></Card></Col>
                      <Col span={8}><Card size="small"><Statistic title={t('notReturned')}
                        value={detail.issuedItems.filter((i: any) => !i.returnedAt).length} /></Card></Col>
                      <Col span={8}><Card size="small"><Statistic title={t('deposit')}
                        value={detail.deposits.filter((d: any) => !d.refundedAt).reduce((s: number, d: any) => s + d.amount, 0)}
                        prefix="¥" /></Card></Col>
                    </Row>
                    <Table size="small" rowKey="id" pagination={false} dataSource={detail.issuedItems}
                      columns={[
                        { title: t('items'), dataIndex: 'name', width: 130 },
                        { title: '数量', dataIndex: 'quantity', width: 70, align: 'right' },
                        { title: '发放', dataIndex: 'issuedAt', width: 110, render: (v) => new Date(v).toLocaleDateString() },
                        { title: '归还', dataIndex: 'returnedAt', width: 110,
                          render: (v) => v ? new Date(v).toLocaleDateString() : <Tag color="orange">{t('notReturned')}</Tag> },
                        { title: '状态', dataIndex: 'condition', width: 90,
                          render: (v) => v ? <Tag color={v === 'GOOD' ? 'green' : 'red'}>
                            {v === 'GOOD' ? '完好' : v === 'DAMAGED' ? '损坏' : '遗失'}</Tag> : '—' },
                        { title: t('compensation'), dataIndex: 'compensation', width: 90, align: 'right',
                          render: (v) => (v ? `¥${v}` : '—') },
                        {
                          title: '', width: 150, render: (_, r: any) => !r.returnedAt && (
                            <Space size={4}>
                              <Button size="small" type="link" onClick={async () => {
                                await api.returnItem(r.id, { condition: 'GOOD' }); message.success('已归还'); openDetail(detail.id);
                              }}>完好</Button>
                              <Button size="small" type="link" danger onClick={async () => {
                                await api.returnItem(r.id, { condition: 'LOST' }); message.success('已按遗失计赔'); openDetail(detail.id);
                              }}>遗失</Button>
                            </Space>
                          ),
                        },
                      ]} />
                  </Space>
                ),
              },
              {
                key: 'violations', label: `${t('violation')}（${detail.violations.length}）`,
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {detail.violationPoints > 0 && (
                      <Alert type={detail.violationPoints >= 10 ? 'error' : 'warning'} showIcon
                        message={`当前累计扣分 ${detail.violationPoints} 分`}
                        description={detail.violationPoints >= 10 ? '已达处理阈值，应启动处理流程。' : undefined} />
                    )}
                    <Table size="small" rowKey="id" pagination={false} dataSource={detail.violations}
                      locale={{ emptyText: '无违规记录' }}
                      columns={[
                        { title: '编号', dataIndex: 'code', width: 110 },
                        { title: '时间', dataIndex: 'occurredAt', width: 100, render: (v) => new Date(v).toLocaleDateString() },
                        { title: '类型', dataIndex: 'type', width: 150 },
                        { title: t('severity'), dataIndex: 'severity', width: 80,
                          render: (v) => <Tag color={v === 'CRITICAL' ? 'red' : v === 'HIGH' ? 'orange' : 'default'}>
                            {labelOf(SEVERITY_LABEL, v, lang)}</Tag> },
                        { title: t('points'), dataIndex: 'points', width: 70, align: 'right' },
                        { title: t('fine'), dataIndex: 'fine', width: 80, align: 'right', render: (v) => (v ? `¥${v}` : '—') },
                        { title: t('status'), dataIndex: 'status', width: 90 },
                      ]} />
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      <Modal
        open={creating} title="新建家属 / 访客档案" onCancel={() => setCreating(false)}
        onOk={async () => {
          const v = await form.validateFields();
          await api.createPerson({
            ...v,
            birthDate: v.birthDate?.toISOString(),
            employeeNo: v.employeeNo || `DP${Date.now().toString().slice(-6)}`,
          });
          message.success('已创建，接下来可在「夫妻与家属」里登记关系');
          setCreating(false); load();
        }}
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="家属没有员工档案，也要建一条记录"
          description="因为消防疏散名单、房间占用、门禁都要算上他们。建完之后去「夫妻与家属」登记配偶 / 子女关系。" />
        <Form form={form} layout="vertical" initialValues={{ personType: 'DEPENDENT', gender: 'FEMALE', idType: 'PASSPORT' }}>
          <Form.Item name="personType" label={t('personType')} rules={[{ required: true }]}>
            <Select options={[
              { value: 'DEPENDENT', label: '家属随迁' },
              { value: 'VISITOR', label: '长期访客' },
              { value: 'INTERN', label: '实习生' },
            ]} />
          </Form.Item>
          <Form.Item name="name" label={t('name')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="employeeNo" label="编号" extra="留空自动生成"><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="gender" label={t('gender')} rules={[{ required: true }]}>
                <Select options={[{ value: 'MALE', label: t('male') }, { value: 'FEMALE', label: t('female') }]} />
              </Form.Item>
            </Col>
            <Col span={12}><Form.Item name="birthDate" label="出生日期"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="nationalityId" label={t('nationality')} rules={[{ required: true }]}>
            <Select options={meta.nationalities.map((n: any) => ({ value: n.id, label: n.nameZh }))} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={10}>
              <Form.Item name="idType" label="证件类型">
                <Select options={['PASSPORT', 'KTP', 'KITAS', 'OTHER'].map((v) => ({ value: v, label: v }))} />
              </Form.Item>
            </Col>
            <Col span={14}><Form.Item name="idNumber" label={t('idNumber')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="hostPersonId" label={t('hostPerson')} rules={[{ required: true }]}
            extra="家属必须挂靠在某位员工名下，并与其同住">
            <Select showSearch filterOption={false} onSearch={searchHosts} options={hostOptions} placeholder="搜索员工姓名或工号" />
          </Form.Item>
          <Form.Item name="religionId" label={t('religion')}>
            <Select allowClear options={meta.religions.map((r: any) => ({ value: r.id, label: r.nameZh }))} />
          </Form.Item>
          <Form.Item name="phone" label={t('phone')}><Input /></Form.Item>
        </Form>
      </Modal>

      <AssignDrawer
        personId={assignFor}
        onClose={() => setAssignFor(null)}
        onDone={() => { setAssignFor(null); load(); if (detail) openDetail(detail.id); }}
      />
    </Space>
  );
}
