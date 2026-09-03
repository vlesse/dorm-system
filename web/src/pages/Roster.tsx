import { useEffect, useState } from 'react';
import { Card, Table, Select, Space, Button, Tag, Statistic, Row, Col, Alert } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { OCC_STATUS_LABEL, PERSON_TYPE_LABEL, labelOf, useMeta } from '../meta';

/**
 * 在住花名册 —— 消防疏散、警方检查、劳工部检查都要这个，
 * 要求「此时此刻」的准确名单，且能一键导出。
 */
export default function Roster() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const [tree, setTree] = useState<any[]>([]);
  const [f, setF] = useState<Record<string, any>>({});
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.tree().then(setTree); }, []);
  useEffect(() => {
    setLoading(true);
    api.roster(f).then(setRows).finally(() => setLoading(false));
  }, [JSON.stringify(f)]);

  const building = tree.find((b) => b.id === f.buildingId);
  const byNat = rows.reduce<Record<string, number>>((m, r) => {
    m[r.nationalityId] = (m[r.nationalityId] ?? 0) + 1; return m;
  }, {});
  const dependents = rows.filter((r) => r.personType === 'DEPENDENT').length;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert
        type="info" showIcon
        message="这份名单就是消防疏散、检查抽查时要交出去的东西"
        description="口径是「当前在住 + 休假保留 + 已分配待入住」，含家属随迁。导出的 CSV 带 BOM，Excel 直接打开不乱码，字段包含证件、紧急联系人。" />

      <Card size="small">
        <Space wrap>
          <Select allowClear style={{ width: 210 }} placeholder={t('building')} value={f.buildingId}
            onChange={(v) => setF((x) => ({ ...x, buildingId: v, floorId: undefined }))}
            options={tree.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
          <Select allowClear style={{ width: 120 }} placeholder={t('floor')} value={f.floorId}
            disabled={!f.buildingId} onChange={(v) => setF((x) => ({ ...x, floorId: v }))}
            options={(building?.floors ?? []).map((fl: any) => ({ value: fl.id, label: `${fl.level} 层` }))} />
          <Select allowClear style={{ width: 130 }} placeholder={t('nationality')} value={f.nationalityId}
            onChange={(v) => setF((x) => ({ ...x, nationalityId: v }))}
            options={meta.nationalities.map((n: any) => ({ value: n.id, label: n.nameZh }))} />
          <Select allowClear style={{ width: 140 }} placeholder={t('roomType')} value={f.roomTypeId}
            onChange={(v) => setF((x) => ({ ...x, roomTypeId: v }))}
            options={meta.roomTypes.filter((r: any) => r.isResidential).map((r: any) => ({ value: r.id, label: r.nameZh }))} />
          <Select allowClear style={{ width: 130 }} placeholder={t('personType')} value={f.personType}
            onChange={(v) => setF((x) => ({ ...x, personType: v }))}
            options={meta.personTypes.map((s: string) => ({ value: s, label: labelOf(PERSON_TYPE_LABEL, s, lang) }))} />
          <Button type="primary" icon={<DownloadOutlined />} href={api.rosterCsvUrl(f)}>{t('export')}</Button>
        </Space>
      </Card>

      <Row gutter={12}>
        <Col span={6}><Card size="small"><Statistic title="名单人数" value={rows.length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={t('dependents')} value={dependents} valueStyle={{ color: '#eb2f96' }} /></Card></Col>
        {Object.entries(byNat).slice(0, 2).map(([id, n]) => (
          <Col span={6} key={id}>
            <Card size="small">
              <Statistic title={meta.nationalities.find((x: any) => x.id === id)?.nameZh ?? id} value={n}
                valueStyle={{ color: meta.nationalities.find((x: any) => x.id === id)?.color }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="occupancyId" loading={loading} dataSource={rows}
          pagination={{ pageSize: 50, size: 'small', showTotal: (n) => `共 ${n} 人`, showSizeChanger: true }}
          scroll={{ x: 1700 }}
          columns={[
            { title: t('building'), dataIndex: 'buildingCode', width: 65, fixed: 'left', render: (v) => `${v}栋` },
            { title: t('floor'), dataIndex: 'floorLevel', width: 55, render: (v) => `${v}F` },
            { title: t('room'), dataIndex: 'roomCode', width: 85, fixed: 'left' },
            { title: t('roomType'), dataIndex: 'roomType', width: 105 },
            { title: t('bed'), dataIndex: 'bedLabel', width: 105 },
            { title: t('employeeNo'), dataIndex: 'employeeNo', width: 95 },
            { title: t('name'), dataIndex: 'name', width: 150,
              render: (v, r: any) => <span>{v} <Tag color={r.nationalityColor}>{r.nationalityId}</Tag>
                {r.personType === 'DEPENDENT' && <Tag color="magenta">家属</Tag>}</span> },
            { title: t('gender'), dataIndex: 'gender', width: 55, render: (v) => (v === 'MALE' ? t('male') : t('female')) },
            { title: '证件', width: 190, render: (_, r: any) => `${r.idType} ${r.idNumber}` },
            { title: t('department'), dataIndex: 'department', width: 125 },
            { title: t('positionLevel'), dataIndex: 'positionLevel', width: 85 },
            { title: t('shift'), dataIndex: 'shift', width: 75 },
            { title: t('religion'), dataIndex: 'religion', width: 95 },
            { title: t('contractor'), dataIndex: 'contractor', width: 180, ellipsis: true },
            { title: t('phone'), dataIndex: 'phone', width: 150 },
            { title: t('emergencyContact'), width: 150,
              render: (_, r: any) => r.emergencyContact ? `${r.emergencyContact} ${r.emergencyPhone ?? ''}` : '—' },
            { title: t('checkInAt'), dataIndex: 'checkInAt', width: 105, render: (v) => new Date(v).toLocaleDateString() },
            { title: t('status'), dataIndex: 'status', width: 100, fixed: 'right',
              render: (v) => <Tag color={v === 'HELD' ? 'purple' : v === 'RESERVED' ? 'gold' : 'blue'}>
                {labelOf(OCC_STATUS_LABEL, v, lang)}</Tag> },
          ]}
        />
      </Card>
    </Space>
  );
}
