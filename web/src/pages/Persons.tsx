import { useEffect, useState } from 'react';
import { Card, Table, Input, Select, Space, Tag, Button, Drawer, Descriptions, App, Popconfirm, Typography } from 'antd';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { EMPLOYMENT_LABEL, OCC_STATUS_LABEL, labelOf, useMeta } from '../meta';
import AssignDrawer from '../components/AssignDrawer';

export default function Persons() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message } = App.useApp();

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [assignFor, setAssignFor] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    api.persons({ q, page, pageSize: 20, ...filters })
      .then(setData)
      .finally(() => setLoading(false));
  };
  useEffect(load, [q, page, JSON.stringify(filters)]);

  const openDetail = (id: number) => api.person(id).then(setDetail);
  const setF = (k: string, v: any) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Card size="small">
        <Space wrap>
          <Input.Search style={{ width: 260 }} placeholder={t('search')} allowClear
            onSearch={(v) => { setPage(1); setQ(v); }} onChange={(e) => !e.target.value && setQ('')} />
          <Select allowClear style={{ width: 130 }} placeholder={t('nationality')}
            onChange={(v) => setF('nationalityId', v)}
            options={meta.nationalities.map((n: any) => ({ value: n.id, label: n.nameZh }))} />
          <Select allowClear style={{ width: 150 }} placeholder={t('department')}
            onChange={(v) => setF('departmentId', v)}
            options={meta.departments.map((d: any) => ({ value: d.id, label: d.nameZh }))} />
          <Select allowClear style={{ width: 120 }} placeholder={t('positionLevel')}
            onChange={(v) => setF('positionLevelId', v)}
            options={meta.positionLevels.map((p: any) => ({ value: p.id, label: p.nameZh }))} />
          <Select allowClear style={{ width: 110 }} placeholder={t('shift')}
            onChange={(v) => setF('shiftId', v)}
            options={meta.shifts.map((s: any) => ({ value: s.id, label: s.nameZh }))} />
          <Select allowClear style={{ width: 160 }} placeholder={t('contractor')}
            onChange={(v) => setF('contractorId', v)}
            options={meta.contractors.map((c: any) => ({ value: c.id, label: c.name }))} />
          <Select allowClear style={{ width: 110 }} placeholder={t('employmentStatus')}
            onChange={(v) => setF('employmentStatus', v)}
            options={meta.employmentStatuses.map((s: string) => ({ value: s, label: labelOf(EMPLOYMENT_LABEL, s, lang) }))} />
          <Select allowClear style={{ width: 140 }} placeholder={t('accommodation')}
            onChange={(v) => setF('housed', v)}
            options={[{ value: 'true', label: t('housed') }, { value: 'false', label: t('unhoused') }]} />
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" loading={loading} dataSource={data.rows}
          pagination={{ current: page, total: data.total, pageSize: 20, onChange: setPage, showTotal: (n) => `共 ${n} 人`, size: 'small' }}
          columns={[
            { title: t('employeeNo'), dataIndex: 'employeeNo', width: 100 },
            { title: t('name'), dataIndex: 'name', width: 150, render: (v, r: any) => (
                <a onClick={() => openDetail(r.id)}>
                  {v} <Tag color={r.nationalityColor} style={{ marginInlineStart: 4 }}>{r.nationalityId}</Tag>
                </a>
              ) },
            { title: t('gender'), dataIndex: 'gender', width: 60, render: (v) => (v === 'MALE' ? t('male') : t('female')) },
            { title: t('department'), dataIndex: 'department', width: 130 },
            { title: t('positionLevel'), dataIndex: 'positionLevel', width: 90 },
            { title: t('shift'), dataIndex: 'shift', width: 80, render: (v, r: any) => v && <Tag color={r.shiftColor}>{v}</Tag> },
            { title: t('contractor'), dataIndex: 'contractor', width: 180, ellipsis: true,
              render: (v, r: any) => <span style={{ color: r.contractorIsSelf ? undefined : '#d46b08' }}>{v}</span> },
            { title: t('employmentStatus'), dataIndex: 'employmentStatus', width: 90,
              render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : v === 'ON_LEAVE' ? 'purple' : 'red'}>{labelOf(EMPLOYMENT_LABEL, v, lang)}</Tag> },
            { title: t('accommodation'), width: 190, render: (_, r: any) =>
                r.accommodation
                  ? <span>{r.accommodation.buildingCode}栋 {r.accommodation.roomCode} · {r.accommodation.bedLabel}
                      {r.accommodation.status === 'HELD' && <Tag color="purple" style={{ marginLeft: 4 }}>{t('held')}</Tag>}</span>
                  : <Tag color="orange">{t('noBed')}</Tag> },
            { title: '', width: 90, render: (_, r: any) =>
                r.employmentStatus !== 'RESIGNED' && (
                  <Button size="small" type="link" onClick={() => setAssignFor(r.id)}>
                    {r.accommodation ? t('transfer') : t('assign')}
                  </Button>
                ) },
          ]}
        />
      </Card>

      <Drawer open={!!detail} width={640} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size={14}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label={t('employeeNo')}>{detail.employeeNo}</Descriptions.Item>
              <Descriptions.Item label={t('gender')}>{detail.gender === 'MALE' ? t('male') : t('female')}</Descriptions.Item>
              <Descriptions.Item label={t('nationality')}>
                <Tag color={detail.nationalityColor}>{detail.nationalityName}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('idNumber')}>{detail.idType} {detail.idNumber}</Descriptions.Item>
              <Descriptions.Item label={t('department')}>{detail.department}</Descriptions.Item>
              <Descriptions.Item label={t('positionLevel')}>{detail.positionLevel}</Descriptions.Item>
              <Descriptions.Item label={t('shift')}>{detail.shift}</Descriptions.Item>
              <Descriptions.Item label={t('phone')}>{detail.phone}</Descriptions.Item>
              <Descriptions.Item label={t('contractor')} span={2}>{detail.contractor}</Descriptions.Item>
              <Descriptions.Item label={t('leaveCycle')}>{detail.leaveCycleMonths} 个月</Descriptions.Item>
              <Descriptions.Item label={t('nextLeave')}>
                {detail.nextLeaveDue
                  ? <span>{new Date(detail.nextLeaveDue).toLocaleDateString()}{' '}
                      <Tag color={detail.leaveDueInDays <= 0 ? 'red' : detail.leaveDueInDays <= 30 ? 'orange' : 'default'}>
                        {detail.leaveDueInDays <= 0 ? `已超期 ${-detail.leaveDueInDays} 天` : `还剩 ${detail.leaveDueInDays} 天`}
                      </Tag>
                    </span>
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('employmentStatus')} span={2}>
                <Tag color={detail.employmentStatus === 'ACTIVE' ? 'green' : detail.employmentStatus === 'ON_LEAVE' ? 'purple' : 'red'}>
                  {labelOf(EMPLOYMENT_LABEL, detail.employmentStatus, lang)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('accommodation')} span={2}>
                {detail.accommodation
                  ? `${detail.accommodation.buildingName} ${detail.accommodation.floorLevel}F ${detail.accommodation.roomCode} · ${detail.accommodation.bedLabel}`
                  : t('noBed')}
              </Descriptions.Item>
            </Descriptions>

            <Space>
              <Button type="primary" size="small" onClick={() => { setAssignFor(detail.id); }}>
                {detail.accommodation ? t('transfer') : t('assign')}
              </Button>
              {detail.accommodation && (
                <Popconfirm title={t('checkout')} onConfirm={async () => {
                  await api.checkout({ personId: detail.id, reason: '人员详情页办理' });
                  message.success('已退宿'); openDetail(detail.id); load();
                }}>
                  <Button danger size="small">{t('checkout')}</Button>
                </Popconfirm>
              )}
            </Space>

            <Card size="small" title={t('history')} styles={{ body: { padding: 0 } }}>
              <Table size="small" rowKey="id" pagination={false} dataSource={detail.history}
                columns={[
                  { title: '位置', render: (_, r: any) => `${r.buildingName} ${r.floorLevel}F ${r.roomCode} · ${r.bedCode}` },
                  { title: '区间', width: 180, render: (_, r: any) =>
                      `${new Date(r.checkInAt).toLocaleDateString()} → ${r.checkOutAt ? new Date(r.checkOutAt).toLocaleDateString() : '至今'}` },
                  { title: t('status'), dataIndex: 'status', width: 90, render: (v) => <Tag>{labelOf(OCC_STATUS_LABEL, v, lang)}</Tag> },
                ]} />
            </Card>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              每次分配 / 调宿 / 退宿都会留下一条区间记录，不会覆盖历史。
            </Typography.Text>
          </Space>
        )}
      </Drawer>

      <AssignDrawer
        personId={assignFor}
        onClose={() => setAssignFor(null)}
        onDone={() => { setAssignFor(null); load(); if (detail) openDetail(detail.id); }}
      />
    </Space>
  );
}
