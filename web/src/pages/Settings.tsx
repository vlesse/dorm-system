import { useEffect, useState } from 'react';
import {
  Card, Tabs, Table, Select, InputNumber, Input, Space, Button, App, Alert, Tag, Switch, Typography, Row, Col,
} from 'antd';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { useMeta, SEVERITY_LABEL, labelOf } from '../meta';

/**
 * 设置页 —— 「不要写死」全靠这里。
 * 排宿规则松紧、职级休假周期与夫妻房资格、国籍分区、房型规格与门槛、
 * 物品与赔偿单价、违规扣分罚款、报修时限、各类阈值，全在这改，改完立即生效。
 */
export default function Settings() {
  const t = useT();
  return (
    <Card size="small">
      <Tabs
        items={[
          { key: 'rules', label: t('rules'), children: <RulesPane /> },
          { key: 'levels', label: `${t('positionLevel')} / ${t('leaveCycle')}`, children: <LevelsPane /> },
          { key: 'zoning', label: t('zoning'), children: <ZoningPane /> },
          { key: 'roomTypes', label: t('roomType'), children: <RoomTypePane /> },
          { key: 'items', label: `${t('items')} / ${t('violation')} / ${t('workOrder')}`, children: <OpsDictPane /> },
          { key: 'thresholds', label: t('thresholds'), children: <ThresholdPane /> },
          { key: 'dicts', label: '基础字典', children: <DictsPane /> },
          { key: 'users', label: t('users'), children: <UsersPane /> },
          { key: 'devices', label: t('devices'), children: <DevicesPane /> },
        ]}
      />
    </Card>
  );
}

function RulesPane() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message } = App.useApp();
  const [rules, setRules] = useState<Record<string, string>>(meta.settings['allocation.rules'] ?? meta.defaultRules);
  const [saving, setSaving] = useState(false);

  const keys = Object.keys(meta.defaultRules);
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
        dataSource={keys.map((k) => ({ key: k }))}
        columns={[
          { title: '规则', dataIndex: 'key', width: 210,
            render: (k: string) => {
              const m = meta.ruleMeta[k];
              return m ? (lang === 'zh' ? m.zh : lang === 'id' ? m.id : m.en) : k;
            } },
          {
            title: '强度', width: 190,
            render: (_: any, r: any) => (
              <Select size="small" style={{ width: 150 }} value={rules[r.key]}
                onChange={(v) => setRules((x) => ({ ...x, [r.key]: v }))}
                options={['OFF', 'SOFT', 'HARD'].map((m) => ({ value: m, label: t(`mode_${m}`) }))} />
            ),
          },
          { title: '说明', render: (_: any, r: any) =>
              <span style={{ color: '#8c8c8c', fontSize: 12 }}>{meta.ruleMeta[r.key]?.hint}</span> },
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
  const update = async (id: number, patch: any) => { await api.updateDict('positionLevels', id, patch); message.success('已保存'); load(); };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon
        message="休假周期按职级配置，支持小数（5.5 个月）"
        description="改完立刻影响「待办告警 → 休假即将到期」的推算。isLeadership 决定谁能住干部房；夫妻房资格决定谁能申请夫妻房。" />
      <Table
        size="small" rowKey="id" pagination={false} dataSource={rows}
        columns={[
          { title: '职级', dataIndex: 'nameZh', width: 110 },
          { title: 'Bahasa', dataIndex: 'nameId', width: 130 },
          { title: 'English', dataIndex: 'nameEn', width: 130 },
          { title: '序位', dataIndex: 'rank', width: 80 },
          {
            title: t('leaveCycle'), dataIndex: 'leaveCycleMonths', width: 160,
            render: (v, r: any) => (
              <InputNumber size="small" min={0.5} max={36} step={0.5} value={v} addonAfter="月"
                onChange={(nv) => nv !== null && nv !== v && update(r.id, { leaveCycleMonths: nv })} />
            ),
          },
          { title: '中层及以上', dataIndex: 'isLeadership', width: 110,
            render: (v, r: any) => <Switch size="small" checked={v} onChange={(nv) => update(r.id, { isLeadership: nv })} /> },
          { title: '可申请夫妻房', dataIndex: 'coupleRoomAllowed', width: 120,
            render: (v, r: any) => <Switch size="small" checked={v} onChange={(nv) => update(r.id, { coupleRoomAllowed: nv })} /> },
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
          <Space wrap>
            <b>{b.code}栋</b><span>{b.name}</span>
            <Select size="small" style={{ width: 160 }} value={b.nationalityId ?? ''} options={natOptions}
              onChange={async (v) => { await api.updateBuilding(b.id, { nationalityId: v || null }); message.success('已保存'); load(); }} />
            <Select size="small" style={{ width: 100 }} value={b.genderPolicy}
              options={[{ value: 'MALE', label: t('male') }, { value: 'FEMALE', label: t('female') }, { value: 'MIXED', label: '混住' }]}
              onChange={async (v) => { await api.updateBuilding(b.id, { genderPolicy: v }); message.success('已保存'); load(); }} />
            <span style={{ fontSize: 12 }}>{t('elevator')}：
              <Switch size="small" checked={b.hasElevator}
                onChange={async (v) => { await api.updateBuilding(b.id, { hasElevator: v }); message.success('已保存'); load(); }} />
            </span>
          </Space>
        }>
          <Space wrap>
            {[...b.floors].reverse().map((f: any) => (
              <Space key={f.id} size={4}>
                <Tag>{f.level}F</Tag>
                <Select size="small" style={{ width: 150 }} value={f.nationalityId ?? ''} options={natOptions}
                  onChange={async (v) => { await api.updateFloor(f.id, { nationalityId: v || null }); message.success('已保存'); load(); }} />
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
  const load = () => api.dict('roomTypes').then((r) => setRows(r.sort((a, b) => a.sortOrder - b.sortOrder)));
  useEffect(() => { load(); }, []);
  const update = async (id: number, patch: any) => { await api.updateDict('roomTypes', id, patch); message.success('已保存'); load(); };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon
        message="房型 = 规格 + 门槛 + 管理模式"
        description={
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <b>标称人数</b>是房型规格（"四人间"就是 4），具体房间可以降标按 3 人住 —— 那是房间上的「核定人数」。<br />
            <b>夫妻房</b>勾上后会自动允许男女同住，并强制要求已核验的配偶关系。<br />
            <b>功能房</b>（洗衣房、祷告室、宿管室）不住人，但占楼层空间，会出现在床位图上。<br />
            <b>管理模式 = 酒店式</b>的房型按短住 / 可预订 / 按天计费处理。
          </div>
        } />
      <Table
        size="small" rowKey="id" pagination={false} dataSource={rows} scroll={{ x: 1200 }}
        columns={[
          { title: '房型', dataIndex: 'nameZh', width: 140, fixed: 'left',
            render: (v, r: any) => <Tag color={r.color}>{v}</Tag> },
          { title: '标称人数', dataIndex: 'defaultCapacity', width: 90, align: 'right' },
          { title: '管理模式', dataIndex: 'managementMode', width: 130,
            render: (v, r: any) => (
              <Select size="small" style={{ width: 110 }} value={v}
                options={[{ value: 'STANDARD', label: '常规宿舍' }, { value: 'HOTEL', label: '酒店式' }]}
                onChange={(nv) => update(r.id, { managementMode: nv })} />
            ) },
          { title: '住宿用房', dataIndex: 'isResidential', width: 90, align: 'center',
            render: (v, r: any) => <Switch size="small" checked={v} onChange={(nv) => update(r.id, { isResidential: nv })} /> },
          { title: '夫妻房', dataIndex: 'isCoupleRoom', width: 80, align: 'center',
            render: (v, r: any) => <Switch size="small" checked={v}
              onChange={(nv) => update(r.id, { isCoupleRoom: nv, allowMixedGender: nv || r.allowMixedGender })} /> },
          { title: '允许男女同住', dataIndex: 'allowMixedGender', width: 110, align: 'center',
            render: (v, r: any) => <Switch size="small" checked={v} onChange={(nv) => update(r.id, { allowMixedGender: nv })} /> },
          { title: '允许家属', dataIndex: 'allowDependents', width: 90, align: 'center',
            render: (v, r: any) => <Switch size="small" checked={v} onChange={(nv) => update(r.id, { allowDependents: nv })} /> },
          { title: '职级门槛', dataIndex: 'minPositionRank', width: 120,
            render: (v, r: any) => (
              <InputNumber size="small" placeholder="不限" value={v} min={0} max={100} step={10}
                onChange={(nv) => update(r.id, { minPositionRank: nv })} />
            ) },
          { title: '每人天费用', dataIndex: 'dailyRate', width: 130,
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

function OpsDictPane() {
  const { lang } = useLang();
  const { message } = App.useApp();
  const [tab, setTab] = useState('itemTypes');
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api.dict(tab).then(setRows);
  useEffect(() => { load(); }, [tab]);
  const update = async (id: number, patch: any) => { await api.updateDict(tab, id, patch); message.success('已保存'); load(); };

  const cols: Record<string, any[]> = {
    itemTypes: [
      { title: '物品', dataIndex: 'nameZh', width: 130 },
      { title: 'Bahasa', dataIndex: 'nameId', width: 140 },
      { title: '需归还', dataIndex: 'isReturnable', width: 90, align: 'center',
        render: (v: boolean, r: any) => <Switch size="small" checked={v} onChange={(nv) => update(r.id, { isReturnable: nv })} /> },
      { title: '押金', dataIndex: 'deposit', width: 120,
        render: (v: number, r: any) => <InputNumber size="small" value={v} min={0} addonBefore="¥"
          onChange={(nv) => nv !== null && nv !== v && update(r.id, { deposit: nv })} /> },
      { title: '赔偿单价', dataIndex: 'price', width: 130,
        render: (v: number, r: any) => <InputNumber size="small" value={v} min={0} addonBefore="¥"
          onChange={(nv) => nv !== null && nv !== v && update(r.id, { price: nv })} /> },
    ],
    violationTypes: [
      { title: '违规类型', dataIndex: 'nameZh', width: 160 },
      { title: '严重程度', dataIndex: 'severity', width: 130,
        render: (v: string, r: any) => (
          <Select size="small" style={{ width: 110 }} value={v}
            options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => ({ value: s, label: labelOf(SEVERITY_LABEL, s, lang) }))}
            onChange={(nv) => update(r.id, { severity: nv })} />
        ) },
      { title: '默认扣分', dataIndex: 'defaultPoints', width: 110,
        render: (v: number, r: any) => <InputNumber size="small" value={v} min={0}
          onChange={(nv) => nv !== null && nv !== v && update(r.id, { defaultPoints: nv })} /> },
      { title: '默认罚款', dataIndex: 'defaultFine', width: 130,
        render: (v: number, r: any) => <InputNumber size="small" value={v} min={0} addonBefore="¥"
          onChange={(nv) => nv !== null && nv !== v && update(r.id, { defaultFine: nv })} /> },
    ],
    workOrderCategories: [
      { title: '报修类别', dataIndex: 'nameZh', width: 150 },
      { title: '完成时限', dataIndex: 'slaHours', width: 140,
        render: (v: number, r: any) => <InputNumber size="small" value={v} min={1} addonAfter="小时"
          onChange={(nv) => nv !== null && nv !== v && update(r.id, { slaHours: nv })} /> },
      { title: '默认影响住宿', dataIndex: 'blocksByDefault', width: 130, align: 'center',
        render: (v: boolean, r: any) => <Switch size="small" checked={v} onChange={(nv) => update(r.id, { blocksByDefault: nv })} /> },
    ],
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Select value={tab} onChange={setTab} style={{ width: 220 }}
        options={[
          { value: 'itemTypes', label: '物品与赔偿单价' },
          { value: 'violationTypes', label: '违规类型与扣分罚款' },
          { value: 'workOrderCategories', label: '报修类别与时限' },
        ]} />
      <Table size="small" rowKey="id" pagination={false} dataSource={rows} columns={cols[tab]} />
    </Space>
  );
}

function ThresholdPane() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api.settings().then(setRows);
  useEffect(() => { load(); }, []);

  const editable = ['leave.warningDays', 'id.expiryWarningDays', 'reserved.staleDays',
    'violation.pointsThreshold', 'leave.autoReleaseDays'];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon message="这些阈值直接决定「待办告警」什么时候报出来" />
      <Table
        size="small" rowKey="key" pagination={false}
        dataSource={rows.filter((r) => editable.includes(r.key))}
        columns={[
          { title: '设置项', dataIndex: 'description', width: 300 },
          { title: 'Key', dataIndex: 'key', width: 220, render: (v) => <code style={{ fontSize: 11 }}>{v}</code> },
          {
            title: '值', width: 160,
            render: (_, r: any) => (
              <InputNumber size="small" defaultValue={Number(r.value)} min={0}
                onBlur={async (e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  if (String(v) !== r.value) { await api.saveSetting(r.key, v); message.success('已保存'); load(); }
                }} />
            ),
          },
        ]}
      />
      <Row gutter={12}>
        <Col span={12}>
          <Card size="small" title="视频网关地址（二期）">
            <Input placeholder="http://10.0.0.9:1984"
              defaultValue={rows.find((r) => r.key === 'video.gatewayUrl')?.value?.replace(/"/g, '')}
              onBlur={async (e) => { await api.saveSetting('video.gatewayUrl', e.target.value); message.success('已保存'); }} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              二期起 go2rtc / MediaMTX 容器后填这里，摄像头点位就能直接播。
            </Typography.Text>
          </Card>
        </Col>
      </Row>
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
    religions: [
      { title: '编码', dataIndex: 'code', width: 110 },
      { title: '中文', dataIndex: 'nameZh' }, { title: 'Bahasa', dataIndex: 'nameId' },
      { title: '有饮食禁忌', dataIndex: 'hasDietaryRule', width: 120,
        render: (v: boolean) => (v ? <Tag color="green">是</Tag> : '') },
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
          { value: 'religions', label: '宗教信仰' },
          { value: 'contractors', label: '雇佣主体 / 承包商' },
        ]} />
      <Table size="small" rowKey="id" pagination={false} dataSource={rows} columns={cols[tab]} />
    </Space>
  );
}

function UsersPane() {
  const meta = useMeta();
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert type="info" showIcon
        message="角色与数据范围已建模，登录鉴权是下一步"
        description="楼栋宿管的数据范围限定到自己那栋楼；宿舍主管、HR、EHS 各看各的。一期先把角色和归属定下来，接入登录后直接生效。" />
      <Table
        size="small" rowKey="id" pagination={false} dataSource={meta.users}
        columns={[
          { title: '账号', dataIndex: 'username', width: 150 },
          { title: '姓名', dataIndex: 'name', width: 180 },
          { title: '角色', dataIndex: 'role', width: 150, render: (v) => <Tag color="blue">{v}</Tag> },
          { title: '数据范围', render: (_, r: any) =>
              r.buildings.length === 0
                ? <Tag>全部楼栋</Tag>
                : r.buildings.map((b: any) => <Tag key={b.id}>{b.code}栋</Tag>) },
        ]} />
      <Table
        size="small" rowKey="id" pagination={false} dataSource={meta.roles}
        title={() => '角色与权限点'}
        columns={[
          { title: '角色', dataIndex: 'nameZh', width: 150 },
          { title: '编码', dataIndex: 'code', width: 150 },
          { title: '权限点', dataIndex: 'permissions', render: (v) => <code style={{ fontSize: 11 }}>{v}</code> },
        ]} />
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
        } />
      <Table
        size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 15, size: 'small' }}
        columns={[
          { title: '类型', dataIndex: 'type', width: 100,
            render: (v) => <Tag color={v === 'CAMERA' ? 'purple' : v === 'DOOR' ? 'blue' : 'gold'}>
              {v === 'CAMERA' ? t('camera') : v === 'DOOR' ? t('door') : t('meter')}</Tag> },
          { title: '名称', dataIndex: 'name' },
          { title: '厂商', dataIndex: 'vendor', width: 110 },
          { title: 'IP', dataIndex: 'ipAddress', width: 140 },
          { title: '挂载', width: 120, render: (_, r: any) => `${r.scopeType} #${r.scopeId}` },
          { title: '启用', dataIndex: 'isActive', width: 100,
            render: (v) => (v ? <Tag color="green">已启用</Tag> : <Tag>{t('phase2')}</Tag>) },
          { title: '备注', dataIndex: 'note', ellipsis: true },
        ]} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        当前已登记 {cameras.length} 个楼道摄像头点位（未启用）、{rows.length - cameras.length} 个门禁与电表点位。
      </Typography.Text>
    </Space>
  );
}
