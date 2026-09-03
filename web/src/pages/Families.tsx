import { useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Tag, Space, Select, Button, App, Modal, Form, Input, Switch,
  Row, Col, Statistic, Alert, Tabs, Popconfirm, Empty,
} from 'antd';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { useMeta, REL_TYPE_LABEL, labelOf } from '../meta';

/**
 * 夫妻与家属。
 * 夫妻房的前置条件是「已登记且已核验的配偶关系」—— 没有这条关系，
 * 排宿规则里的 couple 规则会直接硬拦。
 * 家属（非员工的配偶、随迁子女）挂靠在员工名下，必须与员工同房。
 */
export default function Families() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message, modal } = App.useApp();

  const [rels, setRels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [optA, setOptA] = useState<any[]>([]);
  const [optB, setOptB] = useState<any[]>([]);
  const [coupleRooms, setCoupleRooms] = useState<any[]>([]);
  const [assignFor, setAssignFor] = useState<any>(null);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.relationships().then(setRels).finally(() => setLoading(false));
  };
  useEffect(load, []);

  // 拉出所有夫妻房 / 家庭房的当前占用情况
  const loadCoupleRooms = async () => {
    const tree = await api.tree();
    const coupleTypeIds = meta.roomTypes.filter((r: any) => r.isCoupleRoom).map((r: any) => r.id);
    const out: any[] = [];
    for (const b of tree) {
      for (const f of b.floors) {
        const fl = await api.floor(f.id);
        for (const r of fl.rooms) {
          if (!coupleTypeIds.includes(r.roomType.id)) continue;
          const occ = r.beds.filter((x: any) => x.occupancy);
          out.push({
            ...r, buildingCode: b.code, floorLevel: f.level,
            occupantCount: occ.length,
            occupants: occ.map((x: any) => x.occupancy.person),
            freeBeds: r.beds.filter((x: any) => x.status === 'FREE').length,
          });
        }
      }
    }
    setCoupleRooms(out);
  };
  useEffect(() => { if (meta) loadCoupleRooms(); }, []);

  const searchPersons = async (q: string, setter: (v: any[]) => void) => {
    if (!q) return;
    const r = await api.persons({ q, pageSize: 20 });
    setter(r.rows.map((p: any) => ({
      value: p.id,
      label: `${p.name}（${p.employeeNo}）· ${p.gender === 'MALE' ? '男' : '女'} · ${p.positionLevel ?? '家属'}${p.accommodation ? ' · ' + p.accommodation.roomCode : ' · 未安排'}`,
    })));
  };

  const spouses = useMemo(() => rels.filter((r) => r.type === 'SPOUSE'), [rels]);
  const children = useMemo(() => rels.filter((r) => r.type === 'CHILD'), [rels]);
  const verifiedCount = spouses.filter((r) => r.verified).length;

  const emptyCoupleRooms = coupleRooms.filter((r) => r.occupantCount === 0 && r.status === 'AVAILABLE');
  const singleOccupied = coupleRooms.filter((r) => r.occupantCount === 1);

  const doAssignCouple = async (roomId: number) => {
    try {
      await api.assignCouple({ personIdA: assignFor.a.id, personIdB: assignFor.b.id, roomId, force: true });
      message.success('已安排入住夫妻房');
      setAssignFor(null); load(); loadCoupleRooms();
    } catch (e: any) {
      if (e.body?.blockers) {
        modal.error({
          title: '不满足硬性规则',
          content: <ul style={{ paddingLeft: 18 }}>{e.body.blockers.map((b: any, i: number) => <li key={i}>{b.message}</li>)}</ul>,
        });
      } else message.error(e.message);
    }
  };

  const relTable = (data: any[], type: string) => (
    <Table
      size="small" rowKey="id" loading={loading} dataSource={data}
      pagination={{ pageSize: 20, size: 'small', showTotal: (n) => `共 ${n} 对` }}
      columns={[
        {
          title: type === 'SPOUSE' ? '员工方' : '家长', width: 210,
          render: (_, r: any) => (
            <span>{r.a.name}
              <Tag style={{ marginLeft: 4 }}>{r.a.personType === 'EMPLOYEE' ? '员工' : '家属'}</Tag>
              <br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.a.employeeNo} · {r.a.department ?? '—'}</span>
            </span>
          ),
        },
        {
          title: type === 'SPOUSE' ? '配偶方' : '子女', width: 210,
          render: (_, r: any) => (
            <span>{r.b.name}
              <Tag style={{ marginLeft: 4 }} color={r.b.personType === 'EMPLOYEE' ? 'blue' : 'purple'}>
                {r.b.personType === 'EMPLOYEE' ? '双职工' : '家属随迁'}
              </Tag>
              <br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.b.employeeNo}</span>
            </span>
          ),
        },
        {
          title: t('verified'), dataIndex: 'verified', width: 110,
          render: (v, r: any) => (
            <Switch size="small" checked={v} checkedChildren="已核验" unCheckedChildren="未核验"
              onChange={async (nv) => {
                await api.updateRelationship(r.id, { verified: nv, verifiedBy: 'HR' });
                message.success(nv ? '已标记核验' : '已取消核验'); load();
              }} />
          ),
        },
        { title: '备注', dataIndex: 'note', ellipsis: true },
        {
          title: '', width: 190,
          render: (_, r: any) => type !== 'SPOUSE' ? null : (
            <Space size={4}>
              <Button size="small" type="primary" disabled={!r.verified}
                onClick={() => { setAssignFor(r); loadCoupleRooms(); }}>
                {t('assignCouple')}
              </Button>
              <Popconfirm title="删除该关系？" onConfirm={async () => {
                await api.deleteRelationship(r.id); message.success('已删除'); load();
              }}>
                <Button size="small" danger type="link">删除</Button>
              </Popconfirm>
            </Space>
          ),
        },
      ]}
    />
  );

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon message={t('coupleHint')} />

      <Row gutter={12}>
        <Col span={5}><Card size="small"><Statistic title="登记配偶关系" value={spouses.length} suffix="对" /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="已核验" value={verifiedCount} suffix="对" /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="随迁子女" value={children.length} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="夫妻房空房" value={emptyCoupleRooms.length} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={5}>
          <Card size="small" styles={{ body: { display: 'flex', alignItems: 'center', height: '100%' } }}>
            <Button type="primary" onClick={() => { form.resetFields(); setCreating(true); }}>登记亲属关系</Button>
          </Card>
        </Col>
      </Row>

      {singleOccupied.length > 0 && (
        <Alert type="warning" showIcon
          message={`有 ${singleOccupied.length} 间夫妻房被单人占用`}
          description={`${singleOccupied.slice(0, 6).map((r) => r.code).join('、')}${singleOccupied.length > 6 ? ' 等' : ''} —— 配偶未入住或已离园，房源紧张时应回收。`} />
      )}

      <Tabs items={[
        { key: 'spouse', label: `${t('spouse')}（${spouses.length}）`, children: relTable(spouses, 'SPOUSE') },
        { key: 'child', label: `${t('child')}（${children.length}）`, children: relTable(children, 'CHILD') },
        {
          key: 'rooms', label: `夫妻房 / 家庭房（${coupleRooms.length}）`,
          children: (
            <Table
              size="small" rowKey="id" dataSource={coupleRooms} pagination={{ pageSize: 20, size: 'small' }}
              columns={[
                { title: t('room'), dataIndex: 'code', width: 110 },
                { title: t('building'), width: 110, render: (_, r: any) => `${r.buildingCode}栋 ${r.floorLevel}层` },
                { title: t('roomType'), width: 110, render: (_, r: any) =>
                    <Tag color={r.roomType.color}>{r.roomType.nameZh}</Tag> },
                { title: '核定 / 标称', width: 110, align: 'center',
                  render: (_, r: any) => <span>{r.capacity} / {r.nominalCapacity}
                    {r.isDerated && <Tag color="orange" style={{ marginLeft: 4 }}>降标</Tag>}</span> },
                { title: '在住', dataIndex: 'occupantCount', width: 80, align: 'center',
                  render: (v, r: any) => <Tag color={v === 0 ? 'default' : v === 1 ? 'orange' : 'blue'}>{v}/{r.capacity}</Tag> },
                { title: '住户', render: (_, r: any) => r.occupants.map((p: any) => p.name).join('、') || '—' },
                { title: t('facilities'), width: 150, render: (_, r: any) => (
                    <Space size={2}>
                      {r.hasAC && <Tag>空调</Tag>}
                      {r.hasBathroom && <Tag>独卫</Tag>}
                      {r.hasWaterHeater && <Tag>热水</Tag>}
                    </Space>
                  ) },
                { title: t('status'), dataIndex: 'status', width: 90 },
              ]}
            />
          ),
        },
      ]} />

      {/* 选夫妻房 */}
      <Modal
        open={!!assignFor} width={720} onCancel={() => setAssignFor(null)} footer={null}
        title={assignFor ? `为 ${assignFor.a.name} 与 ${assignFor.b.name} 安排夫妻房` : ''}
      >
        {assignFor && (
          emptyCoupleRooms.length === 0
            ? <Empty description="当前没有完全空置的夫妻房 / 家庭房" />
            : (
              <Table
                size="small" rowKey="id" dataSource={emptyCoupleRooms} pagination={{ pageSize: 8, size: 'small' }}
                columns={[
                  { title: t('room'), dataIndex: 'code', width: 110 },
                  { title: t('building'), width: 110, render: (_, r: any) => `${r.buildingCode}栋 ${r.floorLevel}层` },
                  { title: t('roomType'), width: 100, render: (_, r: any) => <Tag color={r.roomType.color}>{r.roomType.nameZh}</Tag> },
                  { title: t('capacity'), dataIndex: 'capacity', width: 80, align: 'center' },
                  { title: t('facilities'), render: (_, r: any) => (
                      <Space size={2}>
                        {r.hasAC && <Tag>空调</Tag>}{r.hasBathroom && <Tag>独卫</Tag>}
                        {r.hasWaterHeater && <Tag>热水</Tag>}{r.hasBalcony && <Tag>阳台</Tag>}
                      </Space>
                    ) },
                  { title: '', width: 90, render: (_, r: any) =>
                      <Button size="small" type="primary" onClick={() => doAssignCouple(r.id)}>选此房</Button> },
                ]}
              />
            )
        )}
      </Modal>

      {/* 登记关系 */}
      <Modal
        open={creating} title="登记亲属关系" onCancel={() => setCreating(false)}
        onOk={async () => {
          const v = await form.validateFields();
          try {
            await api.createRelationship(v);
            message.success('已登记'); setCreating(false); load();
          } catch (e: any) { message.error(e.message); }
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'SPOUSE', verified: false }}>
          <Form.Item name="type" label="关系类型" rules={[{ required: true }]}>
            <Select options={meta.relationshipTypes.map((s: string) => ({ value: s, label: labelOf(REL_TYPE_LABEL, s, lang) }))} />
          </Form.Item>
          <Form.Item name="personId" label="员工方" rules={[{ required: true }]}>
            <Select showSearch filterOption={false} onSearch={(q) => searchPersons(q, setOptA)} options={optA}
              placeholder="输入姓名或工号搜索" />
          </Form.Item>
          <Form.Item name="relatedPersonId" label="对方（员工或家属档案）" rules={[{ required: true }]}
            extra="家属没有员工档案的，先在「人员」页新建一条 personType=家属随迁 的记录">
            <Select showSearch filterOption={false} onSearch={(q) => searchPersons(q, setOptB)} options={optB}
              placeholder="输入姓名或工号搜索" />
          </Form.Item>
          <Form.Item name="verified" label="是否已核验（结婚证 / 户口本）" valuePropName="checked"
            extra="未核验的配偶关系不能安排夫妻房">
            <Switch />
          </Form.Item>
          <Form.Item name="note" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
