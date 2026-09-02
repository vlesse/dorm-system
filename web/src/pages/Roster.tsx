import { useEffect, useState } from 'react';
import { Card, Table, Select, Space, Button, Tag, Statistic, Row, Col, Alert } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { OCC_STATUS_LABEL, labelOf, useMeta } from '../meta';

/**
 * 在住花名册 —— 消防疏散、警方检查、劳工部检查都要这个，
 * 要求「此时此刻」的准确名单，且能一键导出。
 */
export default function Roster() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const [tree, setTree] = useState<any[]>([]);
  const [buildingId, setBuildingId] = useState<number | undefined>();
  const [floorId, setFloorId] = useState<number | undefined>();
  const [nationalityId, setNationalityId] = useState<string | undefined>();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.tree().then(setTree); }, []);
  useEffect(() => {
    setLoading(true);
    api.roster({ buildingId, floorId, nationalityId }).then(setRows).finally(() => setLoading(false));
  }, [buildingId, floorId, nationalityId]);

  const building = tree.find((b) => b.id === buildingId);
  const byNat = rows.reduce<Record<string, number>>((m, r) => {
    m[r.nationalityId] = (m[r.nationalityId] ?? 0) + 1;
    return m;
  }, {});

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert
        type="info" showIcon
        message="这份名单就是消防疏散、检查抽查时要交出去的东西"
        description="口径是「当前在住 + 休假保留 + 已分配待入住」。导出的 CSV 带 BOM，Excel 直接打开不乱码。"
      />

      <Card size="small">
        <Space wrap>
          <Select allowClear style={{ width: 220 }} placeholder={t('building')} value={buildingId}
            onChange={(v) => { setBuildingId(v); setFloorId(undefined); }}
            options={tree.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
          <Select allowClear style={{ width: 130 }} placeholder={t('floor')} value={floorId}
            disabled={!buildingId} onChange={setFloorId}
            options={(building?.floors ?? []).map((f: any) => ({ value: f.id, label: `${f.level} 层` }))} />
          <Select allowClear style={{ width: 140 }} placeholder={t('nationality')} value={nationalityId}
            onChange={setNationalityId}
            options={meta.nationalities.map((n: any) => ({ value: n.id, label: n.nameZh }))} />
          <Button type="primary" icon={<DownloadOutlined />}
            href={api.rosterCsvUrl({ buildingId, floorId, nationalityId })}>
            {t('export')}
          </Button>
        </Space>
      </Card>

      <Row gutter={12}>
        <Col span={6}><Card size="small"><Statistic title="名单人数" value={rows.length} /></Card></Col>
        {Object.entries(byNat).slice(0, 3).map(([id, n]) => (
          <Col span={6} key={id}>
            <Card size="small">
              <Statistic
                title={meta.nationalities.find((x: any) => x.id === id)?.nameZh ?? id}
                value={n}
                valueStyle={{ color: meta.nationalities.find((x: any) => x.id === id)?.color }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="occupancyId" loading={loading} dataSource={rows}
          pagination={{ pageSize: 50, size: 'small', showTotal: (n) => `共 ${n} 人`, showSizeChanger: true }}
          scroll={{ x: 1200 }}
          columns={[
            { title: t('building'), dataIndex: 'buildingCode', width: 70, render: (v) => `${v}栋` },
            { title: t('floor'), dataIndex: 'floorLevel', width: 60, render: (v) => `${v}F` },
            { title: t('room'), dataIndex: 'roomCode', width: 90 },
            { title: t('bed'), dataIndex: 'bedLabel', width: 90 },
            { title: t('employeeNo'), dataIndex: 'employeeNo', width: 100 },
            { title: t('name'), dataIndex: 'name', width: 150,
              render: (v, r: any) => <span>{v} <Tag color={r.nationalityColor}>{r.nationalityId}</Tag></span> },
            { title: t('gender'), dataIndex: 'gender', width: 60, render: (v) => (v === 'MALE' ? t('male') : t('female')) },
            { title: t('idNumber'), dataIndex: 'idNumber', width: 150 },
            { title: t('department'), dataIndex: 'department', width: 130 },
            { title: t('positionLevel'), dataIndex: 'positionLevel', width: 90 },
            { title: t('shift'), dataIndex: 'shift', width: 80 },
            { title: t('contractor'), dataIndex: 'contractor', width: 190, ellipsis: true },
            { title: t('checkInAt'), dataIndex: 'checkInAt', width: 110,
              render: (v) => new Date(v).toLocaleDateString() },
            { title: t('status'), dataIndex: 'status', width: 100,
              render: (v) => <Tag color={v === 'HELD' ? 'purple' : v === 'RESERVED' ? 'gold' : 'blue'}>{labelOf(OCC_STATUS_LABEL, v, lang)}</Tag> },
          ]}
        />
      </Card>
    </Space>
  );
}
