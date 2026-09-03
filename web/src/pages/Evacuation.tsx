import { useEffect, useState } from 'react';
import { Card, Space, Alert, Row, Col, Statistic, Table, Tag, Collapse, Button, Select, Typography } from 'antd';
import { PrinterOutlined, DownloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useT } from '../i18n';

/**
 * 消防疏散清单。
 * 火灾、地震、警方或劳工部检查时，第一件事就是「这栋楼现在有多少人、都是谁」。
 * 这一页要能一屏看完，并且能立刻打印/导出。
 * 行动不便的人单独标出来 —— 疏散时要有人去背。
 */
export default function Evacuation() {
  const t = useT();
  const [data, setData] = useState<any[]>([]);
  const [buildingId, setBuildingId] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.evacuation(buildingId ? { buildingId } : {}).then(setData).finally(() => setLoading(false));
  };
  useEffect(load, [buildingId]);

  const grandTotal = data.reduce((s, b) => s + b.total, 0);
  const helpTotal = data.reduce((s, b) => s + b.floors.reduce((s2: number, f: any) => s2 + f.needsHelpCount, 0), 0);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="warning" showIcon message={t('evacuation')} description={t('evacuation_hint')} />

      <Row gutter={12}>
        <Col span={6}><Card size="small"><Statistic title="当前在住总人数" value={grandTotal} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={t('needsHelp')} value={helpTotal} valueStyle={{ color: helpTotal ? '#cf1322' : undefined }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="楼栋数" value={data.length} /></Card></Col>
        <Col span={6}>
          <Card size="small" styles={{ body: { display: 'flex', alignItems: 'center', gap: 8, height: '100%' } }}>
            <Select allowClear size="small" style={{ width: 110 }} placeholder={t('building')} value={buildingId}
              onChange={setBuildingId}
              options={data.map((b) => ({ value: b.id, label: `${b.code}栋` }))} />
            <Button size="small" icon={<PrinterOutlined />} onClick={() => window.print()}>打印</Button>
            <Button size="small" icon={<DownloadOutlined />} href={api.rosterCsvUrl(buildingId ? { buildingId } : {})}>CSV</Button>
          </Card>
        </Col>
      </Row>

      {data.map((b) => (
        <Card
          key={b.id} size="small" loading={loading}
          title={
            <Space>
              <b>{b.code}栋</b><span>{b.name}</span>
              <Tag color="blue">在住 {b.total} 人</Tag>
              {b.hasElevator ? <Tag>有电梯</Tag> : <Tag color="orange">无电梯</Tag>}
            </Space>
          }
        >
          <Collapse
            size="small" ghost
            items={b.floors.filter((f: any) => f.count > 0).map((f: any) => ({
              key: f.id,
              label: (
                <Space>
                  <b style={{ width: 44, display: 'inline-block' }}>{f.level}F</b>
                  <Tag color="blue">{f.count} 人</Tag>
                  {f.needsHelpCount > 0 && <Tag color="red">{t('needsHelp')} {f.needsHelpCount}</Tag>}
                </Space>
              ),
              children: (
                <Table
                  size="small" rowKey="personId" dataSource={f.people} pagination={false}
                  columns={[
                    { title: t('room'), dataIndex: 'roomCode', width: 100 },
                    { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
                    { title: t('name'), dataIndex: 'name', width: 160 },
                    { title: t('nationality'), dataIndex: 'nationalityId', width: 80,
                      render: (v) => <Tag>{v}</Tag> },
                    { title: t('status'), dataIndex: 'status', width: 110,
                      render: (v) => v === 'HELD' ? <Tag color="purple">休假保留（可能不在园）</Tag> : <Tag color="blue">在住</Tag> },
                    { title: '', width: 130, render: (_, r: any) =>
                        r.needsHelp ? <Tag color="red">需协助疏散</Tag> : null },
                  ]}
                />
              ),
            }))}
          />
          {b.total === 0 && <Typography.Text type="secondary">该楼栋当前无人在住</Typography.Text>}
        </Card>
      ))}
    </Space>
  );
}
