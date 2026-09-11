import { useEffect, useState } from 'react';
import { Card, Table, Tag, Space, Button, App, Alert as A, Popconfirm, Spin, Badge, Collapse, Empty } from 'antd';
import { api } from '../api';
import { useT } from '../i18n';

/**
 * 待办告警。
 * 这些都是「不主动查就发现不了、但迟早会出事」的地方。
 * 每一条都能直接点过去处理，不用再去别的页面翻。
 */
export default function Alerts() {
  const t = useT();
  const { message } = App.useApp();
  const [a, setA] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.alerts().then(setA);
  useEffect(() => { load(); }, []);
  if (!a) return <Spin />;

  const d = (x: any) => new Date(x).toLocaleDateString();

  const sections: Array<{
    key: string; title: string; rows: any[]; level: 'error' | 'warning' | 'info';
    hint?: string; extra?: React.ReactNode; columns: any[];
  }> = [
    {
      key: 'resignedStillHoused', title: t('alert_resigned'), rows: a.resignedStillHoused, level: 'error',
      hint: '人已离职但床位没释放 —— 这是宿舍数据失真的头号原因，必须清零。',
      extra: a.resignedStillHoused.length > 0 && (
        <Popconfirm
          title="批量办理退宿"
          description={`将为 ${a.resignedStillHoused.length} 名已离职人员办理退宿并释放床位，未归还物品会一并结清，操作会留痕。`}
          onConfirm={async () => {
            setBusy(true);
            try {
              for (const r of a.resignedStillHoused) {
                await api.checkout({ personId: r.personId, reason: '离职批量清退', settleItems: true });
              }
              message.success(`已释放 ${a.resignedStillHoused.length} 张床位`);
              load();
            } finally { setBusy(false); }
          }}
        >
          <Button danger size="small" loading={busy}>一键批量退宿</Button>
        </Popconfirm>
      ),
      columns: [
        { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
        { title: t('name'), dataIndex: 'name', width: 150 },
        { title: t('department'), dataIndex: 'department', width: 130 },
        { title: '占用床位', width: 230, render: (_: any, r: any) => `${r.buildingName} · ${r.roomCode} · ${r.bedCode}` },
        { title: '已占用', dataIndex: 'daysHeld', width: 100, render: (v: number) => <Tag color="red">{v} 天</Tag> },
        {
          title: '', width: 90, render: (_: any, r: any) => (
            <Popconfirm title="办理退宿？" onConfirm={async () => {
              await api.checkout({ personId: r.personId, reason: '离职清退', settleItems: true });
              message.success('已释放'); load();
            }}>
              <Button size="small" danger type="link">{t('checkout')}</Button>
            </Popconfirm>
          ),
        },
      ],
    },
    {
      key: 'idExpiring', title: t('alert_idExpiring'), rows: a.idExpiring, level: 'error',
      hint: `护照 / KITAS 在 ${a.thresholds.idWarnDays} 天内到期。在印尼这是会直接出事的 —— 证件过期意味着非法居留。`,
      columns: [
        { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
        { title: t('name'), dataIndex: 'name', width: 150 },
        { title: t('nationality'), dataIndex: 'nationalityId', width: 80, render: (v: string) => <Tag>{v}</Tag> },
        { title: t('department'), dataIndex: 'department', width: 130 },
        { title: '证件', width: 200, render: (_: any, r: any) => `${r.idType} ${r.idNumber}` },
        { title: t('idExpiry'), dataIndex: 'idExpiryDate', width: 110, render: d },
        { title: '剩余', dataIndex: 'inDays', width: 110,
          render: (v: number) => <Tag color={v <= 0 ? 'red' : v <= 30 ? 'orange' : 'gold'}>
            {v <= 0 ? `已过期 ${-v} 天` : `${v} 天`}</Tag> },
        { title: '护照代管', dataIndex: 'passportHeld', width: 90,
          render: (v: boolean) => (v ? <Tag color="blue">公司保管</Tag> : '') },
      ],
    },
    {
      key: 'workOrderOverdue', title: t('alert_woOverdue'), rows: a.workOrderOverdue, level: 'error',
      hint: '超过该类别承诺时限还没完成的工单。影响住宿的工单会一直占着房间。',
      columns: [
        { title: '单号', dataIndex: 'code', width: 110 },
        { title: t('category'), dataIndex: 'category', width: 120 },
        { title: '标题', dataIndex: 'title', ellipsis: true },
        { title: t('priority'), dataIndex: 'priority', width: 80 },
        { title: '报修', dataIndex: 'reportedAt', width: 110, render: d },
        { title: '超时', dataIndex: 'overdueHours', width: 110,
          render: (v: number) => <Tag color="red">{v} 小时</Tag> },
        { title: t('blocksOccupancy'), dataIndex: 'blocksOccupancy', width: 90,
          render: (v: boolean) => (v ? <Tag color="red">是</Tag> : '') },
      ],
    },
    {
      key: 'complaintOverdue', title: t('alert_complaintOverdue'), rows: a.complaintOverdue, level: 'error',
      hint: '超过该类别时限还没处理的投诉。投诉晚一天和报修晚一天不一样 —— 这是「反映了没人管」，下次这个人就不会再用这个渠道了。',
      columns: [
        { title: '编号', dataIndex: 'code', width: 104 },
        { title: '类别', dataIndex: 'type', width: 170 },
        { title: '位置', dataIndex: 'location', width: 160, ellipsis: true },
        { title: '提交', dataIndex: 'submittedAt', width: 110, render: d },
        { title: '状态', dataIndex: 'status', width: 96,
          render: (v: string) => <Tag>{v}</Tag> },
        { title: '匿名', dataIndex: 'anonymous', width: 64,
          render: (v: boolean) => (v ? <Tag>匿名</Tag> : '') },
        { title: '超时', dataIndex: 'overdueHours', width: 100,
          render: (v: number) => <Tag color="red">{v} 小时</Tag> },
      ],
    },
    {
      key: 'complaintHotRooms', title: t('alert_complaintHotRooms'), rows: a.complaintHotRooms, level: 'warning',
      hint: '按「不同投诉人数」判定，不按条数 —— 条数可以被一个人刷出来，多人独立反映才说明真有问题。',
      columns: [
        { title: '房间', dataIndex: 'roomCode', width: 100,
          render: (v: string, r: any) => <b>{r.buildingCode}栋 {v}</b> },
        { title: '不同投诉人', dataIndex: 'complainants', width: 110,
          render: (v: number) => <Tag color="red">{v} 人</Tag> },
        { title: '投诉条数', dataIndex: 'count', width: 90 },
        { title: '已认定成立', dataIndex: 'substantiated', width: 100 },
        { title: '涉及类别', dataIndex: 'types', ellipsis: true,
          render: (v: string[]) => (v ?? []).join('、') },
        { title: '统计窗口', dataIndex: 'windowDays', width: 90,
          render: (v: number) => `${v} 天` },
      ],
    },
    {
      key: 'overCapacity', title: t('alert_overCapacity'), rows: a.overCapacity, level: 'error',
      hint: '在住人数超过房间核定人数。可能是私自挤住，也可能是加床后没同步调整核定。',
      columns: [
        { title: t('room'), dataIndex: 'roomCode', width: 110 },
        { title: t('building'), width: 110, render: (_: any, r: any) => `${r.building}栋 ${r.floorLevel}层` },
        { title: t('roomType'), dataIndex: 'roomType', width: 120 },
        { title: '标称', dataIndex: 'nominal', width: 70, align: 'center' },
        { title: t('capacity'), dataIndex: 'capacity', width: 90, align: 'center' },
        { title: '实住', dataIndex: 'occupants', width: 80, align: 'center',
          render: (v: number) => <Tag color="red">{v}</Tag> },
        { title: t('deratedReason'), dataIndex: 'deratedReason', ellipsis: true },
      ],
    },
    {
      key: 'coupleAnomalies', title: t('alert_couple'), rows: a.coupleAnomalies, level: 'warning',
      hint: '夫妻房被单人占用（房源浪费），或已登记配偶却分住两处（该安排在一起）。',
      columns: [
        { title: '问题', dataIndex: 'issue', width: 150,
          render: (v: string) => <Tag color={v === 'SINGLE_OCCUPANT' ? 'orange' : 'blue'}>
            {v === 'SINGLE_OCCUPANT' ? '夫妻房单人占用' : '配偶分住'}</Tag> },
        { title: t('name'), dataIndex: 'name', width: 150 },
        { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
        { title: t('room'), dataIndex: 'roomCode', width: 110 },
        { title: '配偶', dataIndex: 'spouseName', width: 140 },
        { title: '说明', dataIndex: 'detail', ellipsis: true },
      ],
    },
    {
      key: 'dependentApart', title: t('alert_dependentApart'), rows: a.dependentApart, level: 'warning',
      hint: '家属必须与挂靠员工住同一房间，否则管理责任说不清。',
      columns: [
        { title: t('name'), dataIndex: 'name', width: 150 },
        { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
        { title: t('hostPerson'), dataIndex: 'hostName', width: 150 },
        { title: t('room'), dataIndex: 'roomCode', width: 110 },
        { title: '说明', dataIndex: 'detail', ellipsis: true },
      ],
    },
    {
      key: 'leaveDueSoon', title: t('alert_leave'), rows: a.leaveDueSoon, level: 'warning',
      hint: `按各自职级的休假周期推算，${a.thresholds.warningDays} 天内到期的人员。周期在「设置 → 职级」里改。`,
      columns: [
        { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
        { title: t('name'), dataIndex: 'name', width: 150 },
        { title: t('department'), dataIndex: 'department', width: 130 },
        { title: t('positionLevel'), dataIndex: 'positionLevel', width: 90 },
        { title: t('leaveCycle'), dataIndex: 'leaveCycleMonths', width: 90, render: (v: number) => `${v} 个月` },
        { title: t('nextLeave'), dataIndex: 'dueAt', width: 120, render: d },
        { title: '剩余', dataIndex: 'inDays', width: 110,
          render: (v: number) => <Tag color={v <= 0 ? 'red' : v <= 14 ? 'orange' : 'default'}>
            {v <= 0 ? `已超期 ${-v} 天` : `${v} 天`}</Tag> },
      ],
    },
    {
      key: 'violationOverLimit', title: t('alert_violation'), rows: a.violationOverLimit, level: 'warning',
      hint: `累计扣分达到 ${a.thresholds.pointsThreshold} 分，应当启动处理流程。`,
      columns: [
        { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
        { title: t('name'), dataIndex: 'name', width: 150 },
        { title: t('department'), dataIndex: 'department', width: 130 },
        { title: '违规次数', dataIndex: 'count', width: 90, align: 'right' },
        { title: '累计扣分', dataIndex: 'points', width: 100, align: 'right',
          render: (v: number) => <Tag color="red">{v}</Tag> },
        { title: '累计罚款', dataIndex: 'fine', width: 100, align: 'right', render: (v: number) => `¥${v}` },
      ],
    },
    {
      key: 'visitorOverstay', title: t('alert_visitorOverstay'), rows: a.visitorOverstay, level: 'warning',
      hint: '访客超过预计离开时间还没登记离园。消防名单会对不上人。',
      columns: [
        { title: '编号', dataIndex: 'code', width: 110 },
        { title: t('visitor'), dataIndex: 'name', width: 150 },
        { title: '被访人', dataIndex: 'host', width: 150 },
        { title: t('overnight'), dataIndex: 'overnight', width: 80,
          render: (v: boolean) => (v ? <Tag color="purple">留宿</Tag> : <Tag>当日</Tag>) },
        { title: t('expectedOut'), dataIndex: 'expectedOutAt', width: 120, render: d },
        { title: '超期', dataIndex: 'overdueDays', width: 100, render: (v: number) => <Tag color="orange">{v} 天</Tag> },
      ],
    },
    {
      key: 'pendingRequests', title: t('alert_pendingRequests'), rows: a.pendingRequests, level: 'warning',
      hint: '申请堆积会直接影响员工体验，也会逼着大家私下换房。',
      columns: [
        { title: '单号', dataIndex: 'code', width: 110 },
        { title: '类型', dataIndex: 'type', width: 140 },
        { title: t('name'), dataIndex: 'name', width: 150 },
        { title: t('reason'), dataIndex: 'reason', ellipsis: true },
        { title: '已等待', dataIndex: 'waitingDays', width: 100,
          render: (v: number) => <Tag color={v > 7 ? 'red' : v > 3 ? 'orange' : 'default'}>{v} 天</Tag> },
      ],
    },
    {
      key: 'itemsNotReturned', title: t('alert_itemsNotReturned'), rows: a.itemsNotReturned, level: 'warning',
      hint: '人已经退宿了，但发放的物品还挂在名下没清点。金额不大，但扯皮最多。',
      columns: [
        { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
        { title: t('name'), dataIndex: 'name', width: 150 },
        { title: t('items'), dataIndex: 'item', width: 130 },
        { title: '数量', dataIndex: 'quantity', width: 70, align: 'right' },
        { title: '单价', dataIndex: 'price', width: 90, align: 'right', render: (v: number) => `¥${v}` },
        { title: '发放日期', dataIndex: 'issuedAt', width: 110, render: d },
        {
          title: '', width: 90, render: (_: any, r: any) => (
            <Button size="small" type="link" onClick={async () => {
              await api.returnItem(r.id, { condition: 'LOST' });
              message.success('已按遗失结算赔偿'); load();
            }}>按遗失结算</Button>
          ),
        },
      ],
    },
    {
      key: 'reservedStale', title: t('alert_reserved'), rows: a.reservedStale, level: 'info',
      hint: `分配了床位但超过 ${a.thresholds.staleDays} 天没办理入住。`,
      columns: [
        { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
        { title: t('name'), dataIndex: 'name', width: 150 },
        { title: t('bed'), dataIndex: 'bedCode', width: 140 },
        { title: '分配时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
      ],
    },
    {
      key: 'statusMismatch', title: t('alert_mismatch'), rows: a.statusMismatch, level: 'info',
      hint: '员工状态与床位状态对不上（休假中却算在住 / 在职却是保留），说明两边流程脱节了。',
      columns: [
        { title: t('employeeNo'), dataIndex: 'employeeNo', width: 110 },
        { title: t('name'), dataIndex: 'name', width: 150 },
        { title: '床位状态', dataIndex: 'occupancyStatus', width: 120 },
        { title: '员工状态', dataIndex: 'employmentStatus', width: 120 },
        { title: t('bed'), dataIndex: 'bedCode' },
      ],
    },
    {
      key: 'deratedMismatch', title: t('alert_deratedMismatch'), rows: a.deratedMismatch, level: 'info',
      hint: '核定人数比可用床位少，说明降标了但床没撤 —— 会被继续排人进去。',
      columns: [
        { title: t('room'), dataIndex: 'roomCode', width: 110 },
        { title: t('building'), dataIndex: 'building', width: 90 },
        { title: t('roomType'), dataIndex: 'roomType', width: 120 },
        { title: t('capacity'), dataIndex: 'capacity', width: 90, align: 'center' },
        { title: '可用床位', dataIndex: 'usableBeds', width: 100, align: 'center',
          render: (v: number) => <Tag color="orange">{v}</Tag> },
        { title: t('deratedReason'), dataIndex: 'deratedReason', ellipsis: true },
      ],
    },
    {
      key: 'functionRoomOccupied', title: t('alert_funcOccupied'), rows: a.functionRoomOccupied, level: 'info',
      hint: '洗衣房、祷告室这类功能房里住了人。',
      columns: [
        { title: t('room'), dataIndex: 'roomCode', width: 120 },
        { title: t('building'), dataIndex: 'building', width: 90 },
        { title: t('roomType'), dataIndex: 'roomType' },
      ],
    },
  ];

  const active = sections.filter((s) => s.rows.length > 0);
  const clean = sections.filter((s) => s.rows.length === 0);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={14}>
      {active.length === 0 && (
        <A type="success" showIcon message="当前没有待办告警 —— 数据是干净的" />
      )}

      {active.map((s) => (
        <Card
          key={s.key} size="small"
          title={
            <span>
              <Badge status={s.level === 'error' ? 'error' : s.level === 'warning' ? 'warning' : 'default'} />
              {' '}{s.title}{' '}
              <Tag color={s.level === 'error' ? 'red' : s.level === 'warning' ? 'orange' : 'default'}>{s.rows.length}</Tag>
            </span>
          }
          extra={s.extra}
        >
          {s.hint && <A type={s.level} showIcon style={{ marginBottom: 10 }} message={s.hint} />}
          <Table size="small" rowKey={(r: any, i) => r.id ?? r.personId ?? r.occupancyId ?? r.roomId ?? i}
            pagination={s.rows.length > 10 ? { pageSize: 10, size: 'small' } : false}
            dataSource={s.rows} columns={s.columns} />
        </Card>
      ))}

      {clean.length > 0 && (
        <Collapse
          size="small"
          items={[{
            key: 'clean',
            label: `已通过的检查项（${clean.length}）`,
            children: (
              <Space wrap>
                {clean.map((s) => <Tag color="green" key={s.key}>✓ {s.title}</Tag>)}
              </Space>
            ),
          }]}
        />
      )}
    </Space>
  );
}
