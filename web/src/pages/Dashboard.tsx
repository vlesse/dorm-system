import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Progress, Tag, Spin, Alert, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { BED_STATUS_COLOR } from '../meta';

export default function Dashboard() {
  const t = useT();
  const { lang } = useLang();
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);

  useEffect(() => { api.dashboard().then(setD); }, []);
  if (!d) return <Spin />;

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const alertTotal = Object.values(d.alertCounts as Record<string, number>).reduce((a, b) => a + b, 0);

  const bars = [
    { key: 'occupied', color: BED_STATUS_COLOR.OCCUPIED, v: d.beds.occupied },
    { key: 'held', color: BED_STATUS_COLOR.HELD, v: d.beds.held },
    { key: 'reserved', color: BED_STATUS_COLOR.RESERVED, v: d.beds.reserved },
    { key: 'free', color: '#d9d9d9', v: d.beds.free },
    { key: 'maintenance', color: BED_STATUS_COLOR.MAINTENANCE, v: d.beds.maintenance },
  ];

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      {alertTotal > 0 && (
        <Alert
          type="warning" showIcon
          message={
            <span>
              有 <b>{alertTotal}</b> 条待办：
              {d.alertCounts.resignedStillHoused > 0 && <Tag color="red" style={{ marginLeft: 8 }}>{t('alert_resigned')} {d.alertCounts.resignedStillHoused}</Tag>}
              {d.alertCounts.leaveDueSoon > 0 && <Tag color="orange">{t('alert_leave')} {d.alertCounts.leaveDueSoon}</Tag>}
              {d.alertCounts.reservedStale > 0 && <Tag color="gold">{t('alert_reserved')} {d.alertCounts.reservedStale}</Tag>}
              {d.alertCounts.statusMismatch > 0 && <Tag>{t('alert_mismatch')} {d.alertCounts.statusMismatch}</Tag>}
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
        <Col span={4}><Card size="small"><Statistic title={t('maintenance')} value={d.beds.maintenance} valueStyle={{ color: BED_STATUS_COLOR.MAINTENANCE }} /></Card></Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title={t('occupancyRate')} value={(d.beds.rate * 100).toFixed(1)} suffix="%" valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col span={8}><Card size="small"><Statistic title={t('people')} value={d.persons.total} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title={t('housed')} value={d.persons.housed} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title={t('unhoused')} value={d.persons.unhoused} valueStyle={{ color: d.persons.unhoused > 0 ? '#fa8c16' : undefined }} /></Card></Col>
      </Row>

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
            { title: t('building'), dataIndex: 'name', render: (v, r: any) => (
                <Space size={6}>
                  <b>{r.code}</b><span>{v}</span>
                  {r.nationalityId && <Tag color={r.nationalityColor} style={{ marginInlineEnd: 0 }}>{r.nationalityId}</Tag>}
                  {r.genderPolicy !== 'MIXED' && <Tag>{r.genderPolicy === 'MALE' ? t('male') : t('female')}</Tag>}
                </Space>
              ) },
            { title: t('floor'), dataIndex: 'floorCount', width: 70, align: 'center' },
            { title: t('totalBeds'), dataIndex: 'total', width: 80, align: 'right' },
            { title: t('occupied'), dataIndex: 'occupied', width: 80, align: 'right' },
            { title: t('held'), dataIndex: 'held', width: 90, align: 'right' },
            { title: t('free'), dataIndex: 'free', width: 80, align: 'right' },
            { title: t('maintenance'), dataIndex: 'oos', width: 90, align: 'right' },
            {
              title: t('occupancyRate'), dataIndex: 'rate', width: 170,
              render: (v: number) => <Progress percent={Number((v * 100).toFixed(1))} size="small" status={v > 0.95 ? 'exception' : 'normal'} />,
            },
          ]}
        />
      </Card>

      <Row gutter={12}>
        <Col span={8}>
          <Card size="small" title={t('byNationality')} styles={{ body: { minHeight: 220 } }}>
            {d.byNationality.map((n: any) => (
              <div key={n.id} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span><Tag color={n.color}>{n.id}</Tag>{n.name}</span>
                  <b>{n.count}</b>
                </div>
                <div className="mini-bar"><i style={{ width: `${(n.count / d.persons.housed) * 100}%`, background: n.color }} /></div>
              </div>
            ))}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title={t('byRoomType')} styles={{ body: { minHeight: 220, padding: 0 } }}>
            <Table size="small" rowKey="name" pagination={false} showHeader={false} dataSource={d.byRoomType}
              columns={[{ dataIndex: 'name' }, { dataIndex: 'count', align: 'right', width: 70, render: (v) => <b>{v}</b> }]} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title={t('byContractor')} styles={{ body: { minHeight: 220, padding: 0 } }}>
            <Table size="small" rowKey="name" pagination={false} showHeader={false} dataSource={d.byContractor}
              columns={[{ dataIndex: 'name' }, { dataIndex: 'count', align: 'right', width: 70, render: (v) => <b>{v}</b> }]} />
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
              title: '', dataIndex: 'count', width: 320,
              render: (v: number) => <div className="mini-bar"><i style={{ width: `${(v / d.byDepartment[0].count) * 100}%`, background: '#1677ff' }} /></div>,
            },
          ]}
        />
      </Card>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {lang === 'zh'
          ? '数据为模拟生成（一期无真实花名册）。二期接 HR 系统后，人员以 HR 为唯一来源同步。'
          : lang === 'id'
            ? 'Data simulasi. Fase 2 akan disinkronkan dari sistem HR.'
            : 'Simulated data. Phase 2 syncs people from the HR system as the single source of truth.'}
      </Typography.Text>
    </Space>
  );
}
