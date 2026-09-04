import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Progress, Tag, Spin, Alert, Space, Typography, List } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { BED_STATUS_COLOR } from '../meta';
import FloorPlan from '../components/FloorPlan';

export default function Dashboard() {
  const t = useT();
  const { lang } = useLang();
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [ann, setAnn] = useState<any[]>([]);

  useEffect(() => {
    api.dashboard().then(setD);
    api.announcements({ active: 'true' }).then((r) => setAnn(r.slice(0, 4)));
  }, []);
  if (!d) return <Spin />;

  const alertTotal = Object.values(d.alertCounts as Record<string, number>).reduce((a: number, b: any) => a + b, 0);
  const alertLabels: Record<string, string> = {
    resignedStillHoused: t('alert_resigned'), idExpiring: t('alert_idExpiring'),
    workOrderOverdue: t('alert_woOverdue'), overCapacity: t('alert_overCapacity'),
    coupleAnomalies: t('alert_couple'), dependentApart: t('alert_dependentApart'),
    leaveDueSoon: t('alert_leave'), violationOverLimit: t('alert_violation'),
    visitorOverstay: t('alert_visitorOverstay'), pendingRequests: t('alert_pendingRequests'),
    itemsNotReturned: t('alert_itemsNotReturned'), reservedStale: t('alert_reserved'),
    statusMismatch: t('alert_mismatch'), deratedMismatch: t('alert_deratedMismatch'),
    functionRoomOccupied: t('alert_funcOccupied'),
  };
  const severe = ['resignedStillHoused', 'idExpiring', 'workOrderOverdue', 'overCapacity'];

  const bars = [
    { key: 'occupied', color: BED_STATUS_COLOR.OCCUPIED, v: d.beds.occupied },
    { key: 'held', color: BED_STATUS_COLOR.HELD, v: d.beds.held },
    { key: 'reserved', color: BED_STATUS_COLOR.RESERVED, v: d.beds.reserved },
    { key: 'free', color: '#d9d9d9', v: d.beds.free },
    { key: 'maintenance', color: BED_STATUS_COLOR.MAINTENANCE, v: d.beds.maintenance },
    { key: 'disabledBeds', color: BED_STATUS_COLOR.DISABLED, v: d.beds.disabled },
  ];

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      {alertTotal > 0 && (
        <Alert
          type="warning" showIcon
          message={
            <span>
              有 <b>{alertTotal}</b> 条待办：
              {Object.entries(d.alertCounts as Record<string, number>)
                .filter(([, v]) => v > 0)
                .sort((a, b) => (severe.includes(b[0]) ? 1 : 0) - (severe.includes(a[0]) ? 1 : 0))
                .slice(0, 6)
                .map(([k, v]) => (
                  <Tag key={k} color={severe.includes(k) ? 'red' : 'orange'} style={{ marginLeft: 6 }}>
                    {alertLabels[k] ?? k} {v}
                  </Tag>
                ))}
            </span>
          }
          action={<a onClick={() => nav('/alerts')}>去处理 →</a>}
        />
      )}

      <Row gutter={12}>
        <Col span={4}><Card size="small"><Statistic title={t('totalBeds')} value={d.beds.total} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('occupied')} value={d.beds.occupied} valueStyle={{ color: BED_STATUS_COLOR.OCCUPIED }} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('held')} value={d.beds.held} valueStyle={{ color: BED_STATUS_COLOR.HELD }} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('free')} value={d.beds.free} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('disabledBeds')} value={d.beds.disabled} valueStyle={{ color: '#8c8c8c' }} /></Card></Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title={t('occupancyRate')} value={(d.beds.rate * 100).toFixed(1)} suffix="%" valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col span={4}><Card size="small"><Statistic title={t('employees')} value={d.persons.employees} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('dependents')} value={d.persons.dependents} valueStyle={{ color: '#eb2f96' }} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('unhoused')} value={d.persons.unhoused} valueStyle={{ color: d.persons.unhoused > 0 ? '#fa8c16' : undefined }} /></Card></Col>
        <Col span={4}>
          <Card size="small" onClick={() => nav('/workorders')} style={{ cursor: 'pointer' }}>
            <Statistic title="未完成工单" value={d.operations.workOrdersOpen}
              suffix={d.operations.workOrdersOverdue > 0 ? <span style={{ fontSize: 12, color: '#cf1322' }}>超时 {d.operations.workOrdersOverdue}</span> : undefined} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small" onClick={() => nav('/violations')} style={{ cursor: 'pointer' }}>
            <Statistic title="待处理违规" value={d.operations.violationsOpen} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small" onClick={() => nav('/requests')} style={{ cursor: 'pointer' }}>
            <Statistic title="待审批申请" value={d.operations.requestsPending}
              valueStyle={{ color: d.operations.requestsPending > 0 ? '#fa8c16' : undefined }} />
          </Card>
        </Col>
      </Row>

      <FloorPlan />

      <Card size="small" title={t('byBuilding')}>
        <div className="mini-bar" style={{ marginBottom: 14 }}>
          {bars.map((b) => (
            <i key={b.key} style={{ width: `${(b.v / d.beds.total) * 100}%`, background: b.color }} title={`${t(b.key)} ${b.v}`} />
          ))}
        </div>
        <Table
          size="small" rowKey="id" pagination={false} dataSource={d.byBuilding}
          onRow={(r: any) => ({ style: { cursor: 'pointer' }, onClick: () => nav(`/beds?building=${r.id}`) })}
          columns={[
            {
              title: t('building'), dataIndex: 'name', render: (v, r: any) => (
                <Space size={6} wrap>
                  <b>{r.code}</b><span>{v}</span>
                  {r.nationalityId && <Tag color={r.nationalityColor} style={{ marginInlineEnd: 0 }}>{r.nationalityId}</Tag>}
                  {r.genderPolicy !== 'MIXED' && <Tag>{r.genderPolicy === 'MALE' ? t('male') : t('female')}</Tag>}
                  {r.hasElevator && <Tag color="blue">{t('elevator')}</Tag>}
                </Space>
              ),
            },
            { title: t('floor'), dataIndex: 'floorCount', width: 60, align: 'center' },
            { title: t('room'), dataIndex: 'roomCount', width: 70, align: 'right' },
            { title: t('functionRoom'), dataIndex: 'functionRoomCount', width: 80, align: 'right',
              render: (v) => (v ? <span style={{ color: '#8c8c8c' }}>{v}</span> : '—') },
            { title: t('derated'), dataIndex: 'deratedRoomCount', width: 80, align: 'right',
              render: (v) => (v ? <Tag color="orange">{v}</Tag> : '—') },
            { title: t('capacity'), dataIndex: 'approvedCapacity', width: 90, align: 'right' },
            { title: t('totalBeds'), dataIndex: 'total', width: 80, align: 'right' },
            { title: t('occupied'), dataIndex: 'occupied', width: 70, align: 'right' },
            { title: t('held'), dataIndex: 'held', width: 90, align: 'right' },
            { title: t('free'), dataIndex: 'free', width: 70, align: 'right' },
            { title: t('disabledBeds'), dataIndex: 'disabled', width: 90, align: 'right',
              render: (v) => (v ? <span style={{ color: '#8c8c8c' }}>{v}</span> : '—') },
            {
              title: t('occupancyRate'), dataIndex: 'rate', width: 150,
              render: (v: number) => <Progress percent={Number((v * 100).toFixed(1))} size="small" status={v > 0.95 ? 'exception' : 'normal'} />,
            },
          ]}
        />
      </Card>

      <Card size="small" title={`${t('byRoomType')} · 标称 / 核定 / 实住`}>
        <Table
          size="small" rowKey="id" pagination={false} dataSource={d.roomTypeStats}
          columns={[
            { title: t('roomType'), dataIndex: 'name', width: 160,
              render: (v, r: any) => <Space size={4}>
                <Tag color={r.color}>{v}</Tag>
                {r.isCoupleRoom && <Tag color="magenta">夫妻</Tag>}
                {!r.isResidential && <Tag>功能房</Tag>}
                {r.managementMode === 'HOTEL' && <Tag color="purple">酒店式</Tag>}
              </Space> },
            { title: '房间数', dataIndex: 'roomCount', width: 80, align: 'right' },
            { title: '标称人数', dataIndex: 'nominalTotal', width: 90, align: 'right',
              render: (v, r: any) => (r.isResidential ? v : '—') },
            { title: t('capacity'), dataIndex: 'approvedCapacity', width: 90, align: 'right',
              render: (v, r: any) => r.isResidential
                ? <span style={{ color: v < r.nominalTotal ? '#fa8c16' : undefined }}>{v}</span> : '—' },
            { title: t('derated'), dataIndex: 'deratedCount', width: 90, align: 'right',
              render: (v) => (v ? <Tag color="orange">{v} 间</Tag> : '—') },
            { title: '撤除床位', dataIndex: 'disabled', width: 90, align: 'right',
              render: (v) => (v ? <span style={{ color: '#8c8c8c' }}>{v}</span> : '—') },
            { title: t('occupied'), dataIndex: 'occupied', width: 80, align: 'right' },
            { title: t('held'), dataIndex: 'held', width: 90, align: 'right' },
            { title: t('free'), dataIndex: 'free', width: 80, align: 'right' },
            {
              title: t('occupancyRate'), width: 150,
              render: (_, r: any) => {
                if (!r.isResidential) return '—';
                const denom = Math.max(r.bedTotal - r.disabled, 1);
                const p = ((r.occupied + r.held) / denom) * 100;
                return <Progress percent={Number(p.toFixed(1))} size="small" />;
              },
            },
          ]}
        />
      </Card>

      <Row gutter={12}>
        <Col span={6}>
          <Card size="small" title={t('byNationality')} styles={{ body: { minHeight: 210 } }}>
            {d.byNationality.map((n: any) => (
              <div key={n.id} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span><Tag color={n.color}>{n.id}</Tag>{n.name}</span><b>{n.count}</b>
                </div>
                <div className="mini-bar"><i style={{ width: `${(n.count / d.persons.housed) * 100}%`, background: n.color }} /></div>
              </div>
            ))}
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" title={t('byPersonType')} styles={{ body: { minHeight: 210, padding: 0 } }}>
            <Table size="small" rowKey="name" pagination={false} showHeader={false} dataSource={d.byPersonType}
              columns={[{ dataIndex: 'name' }, { dataIndex: 'count', align: 'right', width: 70, render: (v) => <b>{v}</b> }]} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" title={t('byContractor')} styles={{ body: { minHeight: 210, padding: 0 } }}>
            <Table size="small" rowKey="name" pagination={false} showHeader={false} dataSource={d.byContractor}
              columns={[{ dataIndex: 'name', ellipsis: true }, { dataIndex: 'count', align: 'right', width: 70, render: (v) => <b>{v}</b> }]} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" title={t('announcement')} styles={{ body: { minHeight: 210 } }}>
            <List
              size="small" dataSource={ann}
              locale={{ emptyText: '暂无公告' }}
              renderItem={(a: any) => (
                <List.Item style={{ padding: '6px 0' }}>
                  <Space direction="vertical" size={0}>
                    <span>
                      <Tag color={a.level === 'URGENT' ? 'red' : a.level === 'WARNING' ? 'orange' : 'blue'}>
                        {a.level === 'URGENT' ? '紧急' : a.level === 'WARNING' ? '注意' : '通知'}
                      </Tag>
                      {lang === 'zh' ? a.title : lang === 'id' ? (a.titleId ?? a.title) : (a.titleEn ?? a.title)}
                    </span>
                    <span style={{ fontSize: 11, color: '#8c8c8c' }}>
                      {a.publishedBy} · {new Date(a.publishedAt).toLocaleDateString()}
                    </span>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" title={t('byDepartment')} styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="name" pagination={false} dataSource={d.byDepartment}
          columns={[
            { title: t('department'), dataIndex: 'name' },
            { title: t('housed'), dataIndex: 'count', width: 100, align: 'right' },
            {
              title: '', width: 320,
              render: (_: any, r: any) => <div className="mini-bar">
                <i style={{ width: `${(r.count / d.byDepartment[0].count) * 100}%`, background: '#1677ff' }} /></div>,
            },
          ]}
        />
      </Card>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        数据为模拟生成（一期无真实花名册）。二期接 HR 系统后，人员以 HR 为唯一来源同步。
      </Typography.Text>
    </Space>
  );
}
