import { useEffect, useState } from 'react';
import { Card, Table, Tag, Space, Button, App, Alert, Popconfirm, Spin, Badge } from 'antd';
import { api } from '../api';
import { useT } from '../i18n';

export default function Alerts() {
  const t = useT();
  const { message } = App.useApp();
  const [a, setA] = useState<any>(null);

  const load = () => api.alerts().then(setA);
  useEffect(() => { load(); }, []);
  if (!a) return <Spin />;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={14}>
      {/* 1. 离职未退宿 —— 最要命的一条 */}
      <Card
        size="small"
        title={<span><Badge status="error" /> {t('alert_resigned')} <Tag color="red">{a.resignedStillHoused.length}</Tag></span>}
        extra={
          a.resignedStillHoused.length > 0 && (
            <Popconfirm
              title="批量办理退宿"
              description={`将为 ${a.resignedStillHoused.length} 名已离职人员办理退宿并释放床位，操作会留痕。`}
              onConfirm={async () => {
                for (const r of a.resignedStillHoused) {
                  await api.checkout({ personId: r.personId, reason: '离职批量清退' });
                }
                message.success(`已释放 ${a.resignedStillHoused.length} 张床位`);
                load();
              }}
            >
              <Button danger size="small">一键批量退宿</Button>
            </Popconfirm>
          )
        }
      >
        <Alert type="error" showIcon style={{ marginBottom: 10 }} message={t('alert_resigned_hint')} />
        <Table
          size="small" rowKey="occupancyId" pagination={{ pageSize: 10, size: 'small' }}
          dataSource={a.resignedStillHoused}
          locale={{ emptyText: '没有离职未退宿的记录 —— 保持住' }}
          columns={[
            { title: t('employeeNo'), dataIndex: 'employeeNo', width: 100 },
            { title: t('name'), dataIndex: 'name', width: 140 },
            { title: t('department'), dataIndex: 'department', width: 130 },
            { title: '占用床位', width: 220, render: (_, r: any) => `${r.buildingName} · ${r.roomCode} · ${r.bedCode}` },
            { title: '已占用', dataIndex: 'daysHeld', width: 100, render: (v) => <Tag color="red">{v} 天</Tag> },
            {
              title: '', width: 90,
              render: (_, r: any) => (
                <Popconfirm title="办理退宿？" onConfirm={async () => {
                  await api.checkout({ personId: r.personId, reason: '离职清退' });
                  message.success('已释放'); load();
                }}>
                  <Button size="small" danger type="link">{t('checkout')}</Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      {/* 2. 休假到期 */}
      <Card size="small" title={<span><Badge status="warning" /> {t('alert_leave')} <Tag color="orange">{a.leaveDueSoon.length}</Tag></span>}>
        <Alert type="info" showIcon style={{ marginBottom: 10 }}
          message={`按各自职级的休假周期推算，${a.warningDays} 天内到期的人员。周期在「设置 → 职级」里改。`} />
        <Table
          size="small" rowKey="personId" pagination={{ pageSize: 10, size: 'small' }}
          dataSource={a.leaveDueSoon}
          columns={[
            { title: t('employeeNo'), dataIndex: 'employeeNo', width: 100 },
            { title: t('name'), dataIndex: 'name', width: 140 },
            { title: t('department'), dataIndex: 'department', width: 130 },
            { title: t('positionLevel'), dataIndex: 'positionLevel', width: 90 },
            { title: t('leaveCycle'), dataIndex: 'leaveCycleMonths', width: 90, render: (v) => `${v} 个月` },
            { title: t('nextLeave'), dataIndex: 'dueAt', width: 120, render: (v) => new Date(v).toLocaleDateString() },
            { title: '剩余', dataIndex: 'inDays', width: 110,
              render: (v: number) => <Tag color={v <= 0 ? 'red' : v <= 14 ? 'orange' : 'default'}>
                {v <= 0 ? `已超期 ${-v} 天` : `${v} 天`}
              </Tag> },
          ]}
        />
      </Card>

      {/* 3. 已分配未入住 */}
      <Card size="small" title={<span><Badge status="warning" /> {t('alert_reserved')} <Tag>{a.reservedStale.length}</Tag></span>}>
        <Table size="small" rowKey="occupancyId" pagination={false} dataSource={a.reservedStale}
          locale={{ emptyText: '无' }}
          columns={[
            { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
            { title: t('name'), dataIndex: 'name', width: 150 },
            { title: t('bed'), dataIndex: 'bedCode', width: 130 },
            { title: '分配时间', dataIndex: 'createdAt', render: (v) => new Date(v).toLocaleString() },
          ]} />
      </Card>

      {/* 4. 状态口径不一致 */}
      <Card size="small" title={<span><Badge status="default" /> {t('alert_mismatch')} <Tag>{a.statusMismatch.length}</Tag></span>}>
        <Alert type="warning" showIcon style={{ marginBottom: 10 }}
          message="员工状态与床位状态对不上（休假中却算在住 / 在职却是保留），说明两边流程脱节了" />
        <Table size="small" rowKey="occupancyId" pagination={{ pageSize: 10, size: 'small' }} dataSource={a.statusMismatch}
          locale={{ emptyText: '无' }}
          columns={[
            { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
            { title: t('name'), dataIndex: 'name', width: 150 },
            { title: '床位状态', dataIndex: 'occupancyStatus', width: 120 },
            { title: '员工状态', dataIndex: 'employmentStatus', width: 120 },
            { title: t('bed'), dataIndex: 'bedCode' },
          ]} />
      </Card>
    </Space>
  );
}
