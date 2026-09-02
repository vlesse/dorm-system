import { useEffect, useState } from 'react';
import {
  Card, Tabs, Table, Select, InputNumber, Input, Space, Button, App, Alert, Tag, Switch, Typography,
} from 'antd';
import { api } from '../api';
import { useT } from '../i18n';
import { useMeta } from '../meta';

/**
 * 设置页 —— 「不要写死」全靠这里。
 * 职级休假周期、国籍分区、排宿规则松紧、房型职级门槛，都在这改，改完立即生效。
 */
export default function Settings() {
  const t = useT();
  const { message } = App.useApp();
  const meta = useMeta();

  return (
    <Card size="small">
      <Tabs
        items={[
          { key: 'rules', label: t('rules'), children: <RulesPane /> },
          { key: 'levels', label: `${t('positionLevel')} / ${t('leaveCycle')}`, children: <LevelsPane /> },
          { key: 'zoning', label: t('zoning'), children: <ZoningPane /> },
          { key: 'roomTypes', label: t('roomType'), children: <RoomTypePane /> },
          { key: 'dicts', label: '其他字典', children: <DictsPane /> },
          { key: 'devices', label: t('devices'), children: <DevicesPane /> },
        ]}
      />
    </Card>
  );
}

const RULE_KEYS = ['gender', 'nationality', 'positionRank', 'shift', 'department', 'contractor', 'capacity', 'roomStatus'] as const;

function RulesPane() {
  const t = useT();
  const meta = useMeta();
  const { message } = App.useApp();
  const [rules, setRules] = useState<Record<string, string>>(meta.settings['allocation.rules'] ?? meta.defaultRules);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSetting('allocation.rules', rules);
      message.success('已保存，立即生效');
    } finally { setSaving(false); }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon message={t('rules_hint')} />
      <Table
        size="small" rowKey="key" pagination={false}
        dataSource={RULE_KEYS.map((k) => ({ key: k }))}
        columns={[
          { title: '规则', dataIndex: 'key', width: 260, render: (k: string) => t(`rule_${k}`) },
          {
            title: '强度', width: 220,
            render: (_, r: any) => (
              <Select
                size="small" style={{ width: 180 }} value={rules[r.key]}
                onChange={(v) => setRules((x) => ({ ...x, [r.key]: v }))}
                options={['OFF', 'SOFT', 'HARD'].map((m) => ({ value: m, label: t(`mode_${m}`) }))}
              />
            ),
          },
          {
            title: '说明',
            render: (_, r: any) => {
              const hint: Record<string, string> = {
                gender: '男女不得同房。建议保持「强制拦截」。',
                nationality: '国籍需符合楼层 / 楼栋归属。默认「仅提醒」，因为确实存在混住。',
                positionRank: '干部单间、专家公寓有职级门槛。',
                shift: '同房间尽量同班次 —— 白班夜班混住是宿舍矛盾第一来源。',
                department: '同房间尽量同部门，便于紧急集合和班车。',
                contractor: '自有员工与承包商工人尽量不混住，费用结算主体不同。',
                capacity: '不得超过核定人数。',
                roomStatus: '维修 / 隔离 / 封锁的房间不能入住。',
              };
              return <span style={{ color: '#8c8c8c', fontSize: 12 }}>{hint[r.key]}</span>;
            },
          },
        ]}
      />
      <Button type="primary" loading={saving} onClick={save}>{t('save')}</Button>
    </Space>
  );
}

function LevelsPane() {
  const t = useT();
  const { message } = App.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api.dict('positionLevels').then((r) => setRows(r.sort((a, b) => a.rank - b.rank)));
  useEffect(() => { load(); }, []);

  const update = async (id: number, patch: any) => {
    await api.updateDict('positionLevels', id, patch);
    message.success('已保存');
    load();
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert
        type="info" showIcon
        message="休假周期按职级配置，支持小数（5.5 个月）"
        description="改完立刻影响「待办告警 → 休假即将到期」的推算。isLeadership 决定谁能住干部房 / 专家公寓。"
      />
      <Table
        size="small" rowKey="id" pagination={false} dataSource={rows}
        columns={[
          { title: '职级', dataIndex: 'nameZh', width: 120 },
          { title: 'Bahasa', dataIndex: 'nameId', width: 140 },
          { title: 'English', dataIndex: 'nameEn', width: 140 },
          { title: '序位 rank', dataIndex: 'rank', width: 100 },
          {
            title: t('leaveCycle'), dataIndex: 'leaveCycleMonths', width: 160,
            render: (v, r: any) => (
              <InputNumber
                size="small" min={0.5} max={36} step={0.5} value={v} addonAfter="月"
                onChange={(nv) => nv !== null && nv !== v && update(r.id, { leaveCycleMonths: nv })}
              />
            ),
          },
          {
            title: '中层及以上', dataIndex: 'isLeadership', width: 120,
            render: (v, r: any) => <Switch size="small" checked={v} onChange={(nv) => update(r.id, { isLeadership: nv })} />,
          },
        ]}
      />
    </Space>
  );
}

function ZoningPane() {
  const t = useT();
  const meta = useMeta();
  const { message } = App.useApp();
  const [tree, setTree] = useState<any[]>([]);
  const load = () => api.tree().then(setTree);
  useEffect(() => { load(); }, []);

  const natOptions = [{ value: '', label: '不限（跟随上级）' }].concat(
    meta.nationalities.map((n: any) => ({ value: n.id, label: n.nameZh }))
  );

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon message={t('zoning_hint')} />
      {tree.map((b) => (
        <Card key={b.id} size="small" title={
          <Space>
            <b>{b.code}栋</b><span>{b.name}</span>
            <Select
              size="small" style={{ width: 170 }} value={b.nationalityId ?? ''}
              options={natOptions}
              onChange={async (v) => { await api.updateBuilding(b.id, { nationalityId: v || null }); message.success('已保存'); load(); }}
            />
            <Select
              size="small" style={{ width: 110 }} value={b.genderPolicy}
              options={[{ value: 'MALE', label: t('male') }, { value: 'FEMALE', label: t('female') }, { value: 'MIXED', label: '混住' }]}
              onChange={async (v) => { await api.updateBuilding(b.id, { genderPolicy: v }); message.success('已保存'); load(); }}
            />
          </Space>
        }>
          <Space wrap>
            {[...b.floors].reverse().map((f: any) => (
              <Space key={f.id} size={4}>
                <Tag>{f.level}F</Tag>
                <Select
                  size="small" style={{ width: 160 }} value={f.nationalityId ?? ''}
                  options={natOptions}
                  onChange={async (v) => { await api.updateFloor(f.id, { nationalityId: v || null }); message.success('已保存'); load(); }}
                />
              </Space>
            ))}
          </Space>
        </Card>
      ))}
    </Space>
  );
}

function RoomTypePane() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api.dict('roomTypes').then(setRows);
  useEffect(() => { load(); }, []);
  const update = async (id: number, patch: any) => { await api.updateDict('roomTypes', id, patch); message.success('已保存'); load(); };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon
        message="房型决定职级门槛和管理模式"
        description="managementMode = HOTEL 的房型按酒店方式管理（短住 / 可预订 / 按天计费），其余按常规宿舍。职级门槛 minPositionRank 留空表示不限。" />
      <Table
        size="small" rowKey="id" pagination={false} dataSource={rows}
        columns={[
          { title: '房型', dataIndex: 'nameZh', width: 130, render: (v, r: any) => <Tag color={r.color}>{v}</Tag> },
          { title: '默认床位', dataIndex: 'defaultCapacity', width: 90 },
          { title: '管理模式', dataIndex: 'managementMode', width: 140,
            render: (v, r: any) => (
              <Select size="small" style={{ width: 120 }} value={v}
                options={[{ value: 'STANDARD', label: '常规宿舍' }, { value: 'HOTEL', label: '酒店式' }]}
                onChange={(nv) => update(r.id, { managementMode: nv })} />
            ) },
          { title: '职级门槛', dataIndex: 'minPositionRank', width: 140,
            render: (v, r: any) => (
              <InputNumber size="small" placeholder="不限" value={v} min={0} max={100} step={10}
                onChange={(nv) => update(r.id, { minPositionRank: nv })} />
            ) },
          { title: '每人天费用', dataIndex: 'dailyRate', width: 140,
            render: (v, r: any) => (
              <InputNumber size="small" value={v} min={0} step={5} addonBefore="¥"
                onChange={(nv) => nv !== null && nv !== v && update(r.id, { dailyRate: nv })} />
            ) },
        ]}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        费用字段一期只存不算账 —— 二期做「按人天分摊 + 承包商月结账单」时直接用。
      </Typography.Text>
    </Space>
  );
}

function DictsPane() {
  const [tab, setTab] = useState('nationalities');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.dict(tab).then(setRows); }, [tab]);

  const cols: Record<string, any[]> = {
    nationalities: [
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '中文', dataIndex: 'nameZh' }, { title: 'Bahasa', dataIndex: 'nameId' },
      { title: 'English', dataIndex: 'nameEn' },
      { title: '色标', dataIndex: 'color', width: 100, render: (v: string) => <Tag color={v}>{v}</Tag> },
    ],
    departments: [
      { title: '编码', dataIndex: 'code', width: 100 },
      { title: '中文', dataIndex: 'nameZh' }, { title: 'Bahasa', dataIndex: 'nameId' },
      { title: 'English', dataIndex: 'nameEn' },
    ],
    shifts: [
      { title: '编码', dataIndex: 'code', width: 100 },
      { title: '中文', dataIndex: 'nameZh' },
      { title: '起', dataIndex: 'startTime', width: 80 }, { title: '止', dataIndex: 'endTime', width: 80 },
      { title: '色标', dataIndex: 'color', width: 100, render: (v: string) => <Tag color={v}>{v}</Tag> },
    ],
    contractors: [
      { title: '编码', dataIndex: 'code', width: 110 },
      { title: '名称', dataIndex: 'name' },
      { title: '自有', dataIndex: 'isSelf', width: 70, render: (v: boolean) => (v ? <Tag color="blue">是</Tag> : '') },
      { title: '联系人', dataIndex: 'contact', width: 100 },
      { title: '电话', dataIndex: 'phone', width: 170 },
    ],
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Select value={tab} onChange={setTab} style={{ width: 200 }}
        options={[
          { value: 'nationalities', label: '国籍' },
          { value: 'departments', label: '部门' },
          { value: 'shifts', label: '班次' },
          { value: 'contractors', label: '雇佣主体 / 承包商' },
        ]} />
      <Table size="small" rowKey="id" pagination={false} dataSource={rows} columns={cols[tab]} />
    </Space>
  );
}

function DevicesPane() {
  const t = useT();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.devices({}).then(setRows); }, []);
  const cameras = rows.filter((r) => r.type === 'CAMERA');

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert
        type="info" showIcon
        message="监控接入是二期的事，但架构今天就留好了"
        description={
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            设备表把「空间节点 ↔ 设备」解耦：楼道摄像头挂在楼层上，门禁挂在楼层上，电表挂在楼栋上。<br />
            二期只需要做两件事：① 起一个独立的视频网关容器（go2rtc / MediaMTX），把海康、大华的 RTSP 转成浏览器能直接播的 WebRTC；
            ② 在这里把 streamPath 填上、isActive 打开。<br />
            <b>主应用永远不碰视频码流</b>，只管「这层楼有哪些摄像头」和「谁有权限看」，所以接监控不用动主库。
          </div>
        }
      />
      <Table
        size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 15, size: 'small' }}
        columns={[
          { title: '类型', dataIndex: 'type', width: 100,
            render: (v) => <Tag color={v === 'CAMERA' ? 'purple' : v === 'DOOR' ? 'blue' : 'gold'}>
              {v === 'CAMERA' ? t('camera') : v === 'DOOR' ? t('door') : t('meter')}
            </Tag> },
          { title: '名称', dataIndex: 'name' },
          { title: '厂商', dataIndex: 'vendor', width: 110 },
          { title: 'IP', dataIndex: 'ipAddress', width: 140 },
          { title: '挂载', width: 120, render: (_, r: any) => `${r.scopeType} #${r.scopeId}` },
          { title: '启用', dataIndex: 'isActive', width: 100,
            render: (v) => (v ? <Tag color="green">已启用</Tag> : <Tag>{t('phase2')}</Tag>) },
          { title: '备注', dataIndex: 'note', ellipsis: true },
        ]}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        当前已登记 {cameras.length} 个楼道摄像头点位（未启用）、{rows.length - cameras.length} 个门禁与电表点位。
      </Typography.Text>
    </Space>
  );
}
