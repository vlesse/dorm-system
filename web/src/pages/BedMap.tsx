import { useEffect, useMemo, useState } from 'react';
import {
  Card, Row, Col, Tag, Spin, Empty, Space, Typography, Select, Drawer, Descriptions,
  Button, Table, Divider, App, Popconfirm, Alert, Segmented,
} from 'antd';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import { BED_STATUS_COLOR, BED_STATUS_LABEL, ROOM_STATUS_LABEL, labelOf, useMeta } from '../meta';
import AssignDrawer from '../components/AssignDrawer';

export default function BedMap() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message } = App.useApp();
  const [sp, setSp] = useSearchParams();

  const [tree, setTree] = useState<any[] | null>(null);
  const [buildingId, setBuildingId] = useState<number | null>(null);
  const [floorId, setFloorId] = useState<number | null>(null);
  const [floor, setFloor] = useState<any>(null);
  const [colorBy, setColorBy] = useState<'status' | 'nationality' | 'shift'>('status');
  const [bedDrawer, setBedDrawer] = useState<any>(null);
  const [assignFor, setAssignFor] = useState<{ bedId: number } | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [bedHistory, setBedHistory] = useState<any[]>([]);

  useEffect(() => { api.tree().then(setTree); }, []);

  useEffect(() => {
    if (!tree || tree.length === 0) return;
    const q = Number(sp.get('building'));
    const b = tree.find((x) => x.id === q) ?? tree[0];
    setBuildingId(b.id);
    setFloorId(b.floors[0]?.id ?? null);
  }, [tree]);

  const loadFloor = (id: number) => {
    api.floor(id).then(setFloor);
    api.devices({ scopeType: 'FLOOR', scopeId: id }).then(setDevices);
  };
  useEffect(() => { if (floorId) loadFloor(floorId); }, [floorId]);

  const building = useMemo(() => tree?.find((b) => b.id === buildingId), [tree, buildingId]);

  const refresh = () => {
    if (floorId) loadFloor(floorId);
    api.tree().then(setTree);
  };

  if (!tree) return <Spin />;
  if (tree.length === 0) return <Empty description="还没有楼栋数据，请先跑 npm run db:seed" />;

  const bedColor = (bed: any) => {
    if (!bed.occupancy) return null;
    if (colorBy === 'nationality') return bed.occupancy.person.nationalityColor;
    if (colorBy === 'shift') return bed.occupancy.person.shiftColor ?? '#8c8c8c';
    return BED_STATUS_COLOR[bed.status] ?? '#1677ff';
  };

  const openBed = (bed: any, room: any) => {
    setBedDrawer({ bed, room });
    api.bedHistory(bed.id).then(setBedHistory);
  };

  return (
    <Row gutter={12} style={{ height: '100%' }}>
      {/* 左：楼栋 + 楼层 */}
      <Col flex="230px">
        <Card size="small" styles={{ body: { padding: 10 } }}>
          <Select
            style={{ width: '100%', marginBottom: 10 }}
            value={buildingId ?? undefined}
            onChange={(v) => {
              setBuildingId(v);
              const b = tree.find((x) => x.id === v);
              setFloorId(b?.floors[0]?.id ?? null);
              setSp({ building: String(v) });
            }}
            options={tree.map((b) => ({ value: b.id, label: `${b.code} · ${b.name.replace(/^.栋\s*/, '')}` }))}
          />
          {building && (
            <div style={{ marginBottom: 10, fontSize: 12, color: '#8c8c8c' }}>
              <Space size={4} wrap>
                {building.nationalityId
                  ? <Tag color={building.nationalityColor}>{t('nationality')}: {building.nationalityId}</Tag>
                  : <Tag>{t('nationality')}: {t('all')}</Tag>}
                <Tag>{building.genderPolicy === 'MALE' ? t('male') : building.genderPolicy === 'FEMALE' ? t('female') : '混'}</Tag>
              </Space>
              {building.note && <div style={{ marginTop: 6 }}>{building.note}</div>}
            </div>
          )}
          <Divider style={{ margin: '8px 0' }} />
          {/* 楼层从下往上排，跟真实楼一样 */}
          <div className="floor-strip">
            {building?.floors.map((f: any) => {
              const used = f.stats.occupied + f.stats.held;
              const rate = f.stats.total ? used / f.stats.total : 0;
              return (
                <div
                  key={f.id}
                  className={`floor-btn${f.id === floorId ? ' active' : ''}`}
                  onClick={() => setFloorId(f.id)}
                >
                  <b style={{ width: 26 }}>{f.level}F</b>
                  {f.nationalityId
                    ? <Tag color={f.nationalityColor} style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>{f.nationalityId}</Tag>
                    : <span style={{ width: 26 }} />}
                  <div className="floor-bar"><i style={{ width: `${rate * 100}%` }} /></div>
                  <span style={{ color: '#8c8c8c', fontSize: 11, width: 52, textAlign: 'right' }}>
                    {used}/{f.stats.total}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </Col>

      {/* 右：床位图 */}
      <Col flex="auto">
        <Card
          size="small"
          title={
            <Space>
              <span>{building?.code}栋 · {floor?.name}</span>
              {floor?.nationalityId && <Tag color={meta.nationalities.find((n: any) => n.id === floor.nationalityId)?.color}>
                {t('zoning')}: {floor.nationalityId}
              </Tag>}
              {!floor?.nationalityId && floor && <Tag>{t('zoning')}: {t('all')}（跟随楼栋）</Tag>}
            </Space>
          }
          extra={
            <Space>
              <Segmented
                size="small" value={colorBy} onChange={(v) => setColorBy(v as any)}
                options={[
                  { label: t('status'), value: 'status' },
                  { label: t('nationality'), value: 'nationality' },
                  { label: t('shift'), value: 'shift' },
                ]}
              />
            </Space>
          }
        >
          <div className="legend" style={{ marginBottom: 12 }}>
            {colorBy === 'status' && Object.entries(BED_STATUS_COLOR).map(([k, c]) => (
              <span key={k}><i className="dot" style={{ background: c, border: k === 'FREE' ? '1px dashed #d9d9d9' : undefined }} />
                {labelOf(BED_STATUS_LABEL, k, lang)}</span>
            ))}
            {colorBy === 'nationality' && meta.nationalities.map((n: any) => (
              <span key={n.id}><i className="dot" style={{ background: n.color }} />{n.nameZh}</span>
            ))}
            {colorBy === 'shift' && meta.shifts.map((s: any) => (
              <span key={s.id}><i className="dot" style={{ background: s.color }} />{s.nameZh}</span>
            ))}
          </div>

          {!floor ? <Spin /> : (
            <Row gutter={[10, 10]}>
              {floor.rooms.map((room: any) => {
                const out = room.status !== 'AVAILABLE';
                const used = room.beds.filter((b: any) => b.occupancy).length;
                return (
                  <Col key={room.id} xs={12} sm={8} md={6} lg={4} xxl={3}>
                    <div className={`room-card${out ? ' is-out' : ''}`}>
                      <div className="room-head">
                        <span className="room-code">{room.code}</span>
                        <span className="room-meta">{used}/{room.capacity}</span>
                      </div>
                      <div className="room-meta" style={{ marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <Tag color={room.roomType.color} style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', marginInlineEnd: 4 }}>
                          {lang === 'zh' ? room.roomType.nameZh : lang === 'id' ? room.roomType.nameId : room.roomType.nameEn}
                        </Tag>
                        {out && <Tag color="red" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                          {labelOf(ROOM_STATUS_LABEL, room.status, lang)}
                        </Tag>}
                      </div>
                      <div className="bed-grid">
                        {room.beds.map((bed: any) => {
                          const c = bedColor(bed);
                          const oos = ['MAINTENANCE', 'LOCKED'].includes(bed.status);
                          return (
                            <div
                              key={bed.id}
                              className={`bed-cell${bed.occupancy ? '' : oos ? ' oos' : ' free'}`}
                              style={c ? { background: c } : undefined}
                              title={bed.occupancy
                                ? `${bed.label} · ${bed.occupancy.person.name} (${bed.occupancy.person.employeeNo})`
                                : `${bed.label} · ${labelOf(BED_STATUS_LABEL, bed.status, lang)}`}
                              onClick={() => openBed(bed, room)}
                            >
                              {bed.occupancy ? bed.occupancy.person.name.slice(0, 1) : bed.label.slice(0, 1)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </Col>
                );
              })}
            </Row>
          )}

          {devices.length > 0 && (
            <>
              <Divider style={{ margin: '16px 0 10px' }} orientation="left" plain>
                {t('devices')}
              </Divider>
              <Space wrap>
                {devices.map((dv) => (
                  <Tag key={dv.id} color={dv.isActive ? 'blue' : undefined} style={{ opacity: dv.isActive ? 1 : 0.6 }}>
                    {dv.type === 'CAMERA' ? '📹' : dv.type === 'DOOR' ? '🚪' : '⚡'} {dv.name}
                    {!dv.isActive && <span style={{ marginLeft: 6, fontSize: 10 }}>({t('phase2')})</span>}
                  </Tag>
                ))}
              </Space>
              <div style={{ marginTop: 6, fontSize: 11, color: '#8c8c8c' }}>{t('devices_hint')}</div>
            </>
          )}
        </Card>
      </Col>

      {/* 床位抽屉 */}
      <Drawer
        open={!!bedDrawer} width={520} onClose={() => setBedDrawer(null)}
        title={bedDrawer ? `${bedDrawer.room.code} · ${bedDrawer.bed.label}` : ''}
      >
        {bedDrawer && (
          <Space direction="vertical" style={{ width: '100%' }} size={14}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label={t('bed')}>{bedDrawer.bed.code}</Descriptions.Item>
              <Descriptions.Item label={t('status')}>
                <Tag color={BED_STATUS_COLOR[bedDrawer.bed.status]}>{labelOf(BED_STATUS_LABEL, bedDrawer.bed.status, lang)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('roomType')}>{bedDrawer.room.roomType.nameZh}</Descriptions.Item>
              <Descriptions.Item label={t('capacity')}>{bedDrawer.room.capacity}</Descriptions.Item>
            </Descriptions>

            {bedDrawer.bed.occupancy ? (
              <Card size="small" title={t('occupied')}>
                <Descriptions size="small" column={2}>
                  <Descriptions.Item label={t('name')}>
                    <b>{bedDrawer.bed.occupancy.person.name}</b>
                  </Descriptions.Item>
                  <Descriptions.Item label={t('employeeNo')}>{bedDrawer.bed.occupancy.person.employeeNo}</Descriptions.Item>
                  <Descriptions.Item label={t('nationality')}>
                    <Tag color={bedDrawer.bed.occupancy.person.nationalityColor}>{bedDrawer.bed.occupancy.person.nationalityId}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label={t('department')}>{bedDrawer.bed.occupancy.person.department}</Descriptions.Item>
                  <Descriptions.Item label={t('positionLevel')}>{bedDrawer.bed.occupancy.person.positionLevel}</Descriptions.Item>
                  <Descriptions.Item label={t('shift')}>{bedDrawer.bed.occupancy.person.shift}</Descriptions.Item>
                  <Descriptions.Item label={t('contractor')} span={2}>{bedDrawer.bed.occupancy.person.contractor}</Descriptions.Item>
                  <Descriptions.Item label={t('checkInAt')} span={2}>
                    {new Date(bedDrawer.bed.occupancy.checkInAt).toLocaleDateString()}
                  </Descriptions.Item>
                </Descriptions>
                {bedDrawer.bed.occupancy.person.employmentStatus === 'RESIGNED' && (
                  <Alert type="error" showIcon style={{ marginTop: 8 }}
                    message="该人员已离职，床位未释放" description="请办理退宿，否则空床数据会持续失真。" />
                )}
                <Space style={{ marginTop: 12 }}>
                  <Popconfirm
                    title={t('checkout')} description="确认办理退宿？床位将立即释放。"
                    onConfirm={async () => {
                      await api.checkout({ personId: bedDrawer.bed.occupancy.person.id, reason: '宿管办理退宿' });
                      message.success('已退宿');
                      setBedDrawer(null); refresh();
                    }}
                  >
                    <Button danger size="small">{t('checkout')}</Button>
                  </Popconfirm>
                  {bedDrawer.bed.occupancy.status === 'ACTIVE' ? (
                    <Button size="small" onClick={async () => {
                      await api.hold({ personId: bedDrawer.bed.occupancy.person.id });
                      message.success('已置为休假保留'); setBedDrawer(null); refresh();
                    }}>{t('hold')}</Button>
                  ) : (
                    <Button size="small" onClick={async () => {
                      await api.resume({ personId: bedDrawer.bed.occupancy.person.id });
                      message.success('已恢复在住'); setBedDrawer(null); refresh();
                    }}>{t('resume')}</Button>
                  )}
                </Space>
              </Card>
            ) : (
              <Card size="small">
                <Space direction="vertical">
                  <Typography.Text type="secondary">{t('empty')}</Typography.Text>
                  <Button type="primary" size="small" disabled={bedDrawer.bed.status !== 'FREE'}
                    onClick={() => setAssignFor({ bedId: bedDrawer.bed.id })}>
                    {t('assign')}
                  </Button>
                </Space>
              </Card>
            )}

            <Card size="small" title={t('history')} styles={{ body: { padding: 0 } }}>
              <Table
                size="small" rowKey="id" pagination={false} dataSource={bedHistory}
                locale={{ emptyText: '无历史记录' }}
                columns={[
                  { title: t('name'), dataIndex: ['person', 'name'], render: (v, r: any) => <span>{v}<br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.person.employeeNo}</span></span> },
                  { title: t('department'), dataIndex: ['person', 'department'], width: 110 },
                  {
                    title: '住宿区间', width: 150,
                    render: (_: any, r: any) =>
                      `${new Date(r.checkInAt).toLocaleDateString()} → ${r.checkOutAt ? new Date(r.checkOutAt).toLocaleDateString() : '至今'}`,
                  },
                ]}
              />
              <div style={{ padding: '6px 10px', fontSize: 11, color: '#8c8c8c' }}>
                时间区间模型：这张床历史上住过谁全部可查，事故追溯 / 检查时用得上。
              </div>
            </Card>
          </Space>
        )}
      </Drawer>

      <AssignDrawer
        bedId={assignFor?.bedId ?? null}
        onClose={() => setAssignFor(null)}
        onDone={() => { setAssignFor(null); setBedDrawer(null); refresh(); }}
      />
    </Row>
  );
}
