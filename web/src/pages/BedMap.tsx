import { useEffect, useMemo, useState } from 'react';
import {
  Card, Row, Col, Tag, Spin, Empty, Space, Typography, Select, Drawer, Descriptions,
  Button, Table, Divider, App, Popconfirm, Alert, Segmented, Modal, InputNumber, Input, Tooltip,
} from 'antd';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useT, useLang } from '../i18n';
import {
  BED_STATUS_COLOR, BED_STATUS_LABEL, ROOM_STATUS_LABEL, BED_POSITION_LABEL,
  PERSON_TYPE_LABEL, labelOf, useMeta,
} from '../meta';
import AssignDrawer from '../components/AssignDrawer';

export default function BedMap() {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const { message, modal } = App.useApp();
  const [sp, setSp] = useSearchParams();

  const [tree, setTree] = useState<any[] | null>(null);
  const [buildingId, setBuildingId] = useState<number | null>(null);
  const [floorId, setFloorId] = useState<number | null>(null);
  const [floor, setFloor] = useState<any>(null);
  const [colorBy, setColorBy] = useState<'status' | 'nationality' | 'shift' | 'personType'>('status');
  const [showFunc, setShowFunc] = useState(true);
  const [bedDrawer, setBedDrawer] = useState<any>(null);
  const [roomDrawer, setRoomDrawer] = useState<any>(null);
  const [assignFor, setAssignFor] = useState<{ bedId: number } | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [bedHistory, setBedHistory] = useState<any[]>([]);
  const [capModal, setCapModal] = useState<any>(null);
  const [capValue, setCapValue] = useState(0);
  const [capReason, setCapReason] = useState('');
  const [qr, setQr] = useState<any>(null);
  const [floorQrs, setFloorQrs] = useState<any[] | null>(null);

  useEffect(() => { api.tree().then(setTree); }, []);

  useEffect(() => {
    if (!tree || tree.length === 0) return;
    const q = Number(sp.get('building'));
    const b = tree.find((x) => x.id === q) ?? tree[0];
    setBuildingId(b.id);
    // 总览的楼栋剖面图可以直接点到某一层
    const wantFloor = Number(sp.get('floor'));
    const f = b.floors.find((x: any) => x.id === wantFloor);
    setFloorId(f?.id ?? b.floors[0]?.id ?? null);
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
    const p = bed.occupancy.person;
    if (colorBy === 'nationality') return p.nationalityColor;
    if (colorBy === 'shift') return p.shiftColor ?? '#8c8c8c';
    if (colorBy === 'personType') return p.personType === 'DEPENDENT' ? '#eb2f96' : p.personType === 'INTERN' ? '#13c2c2' : '#1677ff';
    return BED_STATUS_COLOR[bed.status] ?? '#1677ff';
  };

  const openBed = (bed: any, room: any) => {
    setBedDrawer({ bed, room });
    api.bedHistory(bed.id).then(setBedHistory);
  };
  const openRoom = (roomId: number) => api.room(roomId).then(setRoomDrawer);

  const rooms = (floor?.rooms ?? []).filter((r: any) => showFunc || r.roomType.isResidential);

  return (
    <Row gutter={12} style={{ height: '100%' }}>
      {/* 左：楼栋 + 楼层 */}
      <Col flex="0 0 240px">
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
                  ? <Tag color={building.nationalityColor}>{building.nationalityId}</Tag>
                  : <Tag>国籍不限</Tag>}
                <Tag>{building.genderPolicy === 'MALE' ? t('male') : building.genderPolicy === 'FEMALE' ? t('female') : '男女混'}</Tag>
                {building.hasElevator ? <Tag color="blue">有电梯</Tag> : <Tag>无电梯</Tag>}
              </Space>
              <div style={{ marginTop: 6 }}>
                房间 {building.roomCount}（功能房 {building.functionRoomCount}）· 核定 {building.approvedCapacity} 人
                {building.deratedRoomCount > 0 && <span style={{ color: '#fa8c16' }}> · 降标 {building.deratedRoomCount} 间</span>}
              </div>
              {building.note && <div style={{ marginTop: 6 }}>{building.note}</div>}
            </div>
          )}
          <Divider style={{ margin: '8px 0' }} />
          {/* 楼层从下往上排，跟真实楼一样 */}
          <div className="floor-strip">
            {building?.floors.map((f: any) => {
              const used = f.stats.occupied + f.stats.held;
              const denom = Math.max(f.stats.total - f.stats.disabled - f.stats.maintenance, 1);
              return (
                <div key={f.id} className={`floor-btn${f.id === floorId ? ' active' : ''}`} onClick={() => setFloorId(f.id)}>
                  <b style={{ width: 26 }}>{f.level}F</b>
                  {f.nationalityId
                    ? <Tag color={f.nationalityColor} style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>{f.nationalityId}</Tag>
                    : <span style={{ width: 26 }} />}
                  <div className="floor-bar"><i style={{ width: `${(used / denom) * 100}%` }} /></div>
                  <span style={{ color: '#8c8c8c', fontSize: 11, width: 52, textAlign: 'right' }}>{used}/{denom}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </Col>

      {/* 右：床位图。flex 基准必须是 0 且允许收缩，否则内容一宽就把整列挤到下一行 */}
      <Col flex="1 1 0" style={{ minWidth: 0 }}>
        <Card
          size="small"
          title={
            <Space wrap>
              <span>{building?.code}栋 · {floor?.name}</span>
              {floor?.nationalityId
                ? <Tag color={meta.nationalities.find((n: any) => n.id === floor.nationalityId)?.color}>{t('zoning')}: {floor.nationalityId}</Tag>
                : floor && <Tag>{t('zoning')}: 跟随楼栋</Tag>}
              {floor && <Tag>核定 {rooms.reduce((s: number, r: any) => s + r.capacity, 0)} 人</Tag>}
            </Space>
          }
          extra={
            <Space>
              <Button size="small" type={showFunc ? 'default' : 'primary'} onClick={() => setShowFunc(!showFunc)}>
                {showFunc ? '隐藏功能房' : '显示功能房'}
              </Button>
              <Button size="small" disabled={!floorId}
                onClick={async () => setFloorQrs(await api.floorQrCodes(floorId!))}>
                打印门牌
              </Button>
              <Segmented
                size="small" value={colorBy} onChange={(v) => setColorBy(v as any)}
                options={[
                  { label: t('status'), value: 'status' },
                  { label: t('nationality'), value: 'nationality' },
                  { label: t('shift'), value: 'shift' },
                  { label: '类型', value: 'personType' },
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
            {colorBy === 'personType' && <>
              <span><i className="dot" style={{ background: '#1677ff' }} />员工</span>
              <span><i className="dot" style={{ background: '#eb2f96' }} />家属随迁</span>
              <span><i className="dot" style={{ background: '#13c2c2' }} />实习生</span>
            </>}
          </div>

          {!floor ? <Spin /> : (
            <Row gutter={[10, 10]}>
              {rooms.map((room: any) => {
                const out = room.status !== 'AVAILABLE';
                const used = room.beds.filter((b: any) => b.occupancy).length;
                const isFunc = !room.roomType.isResidential;
                return (
                  <Col key={room.id} xs={12} sm={8} md={6} lg={4} xxl={3}>
                    <div className={`room-card${out || isFunc ? ' is-out' : ''}`}>
                      <div className="room-head">
                        <span className="room-code">
                          <a onClick={() => openRoom(room.id)}>{room.code}</a>
                        </span>
                        {!isFunc && (
                          <Tooltip title={`在住 ${used} / 核定 ${room.capacity}（房型标称 ${room.nominalCapacity}）`}>
                            <span className="room-meta">
                              {used}/{room.capacity}
                              {room.isDerated && <span style={{ color: '#fa8c16' }}> ↓{room.nominalCapacity}</span>}
                            </span>
                          </Tooltip>
                        )}
                      </div>
                      <div className="room-meta" style={{ marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <Tag color={room.roomType.color} style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', marginInlineEnd: 4 }}>
                          {lang === 'zh' ? room.roomType.nameZh : lang === 'id' ? room.roomType.nameId : room.roomType.nameEn}
                        </Tag>
                        {room.roomType.isCoupleRoom && <Tag color="magenta" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>夫妻</Tag>}
                        {room.isDerated && <Tag color="orange" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>降标</Tag>}
                        {out && <Tag color="red" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                          {labelOf(ROOM_STATUS_LABEL, room.status, lang)}</Tag>}
                      </div>
                      {isFunc ? (
                        <div style={{ fontSize: 11, color: '#8c8c8c', padding: '6px 0' }}>功能房 · 不住人</div>
                      ) : (
                        <div className="bed-grid">
                          {room.beds.map((bed: any) => {
                            const c = bedColor(bed);
                            const oos = ['MAINTENANCE', 'LOCKED'].includes(bed.status);
                            const dis = bed.status === 'DISABLED';
                            return (
                              <div
                                key={bed.id}
                                className={`bed-cell${bed.occupancy ? '' : dis ? ' disabled' : oos ? ' oos' : ' free'}`}
                                style={c ? { background: c } : undefined}
                                title={bed.occupancy
                                  ? `${bed.label} · ${bed.occupancy.person.name}（${bed.occupancy.person.employeeNo}）`
                                  : `${bed.label} · ${labelOf(BED_STATUS_LABEL, bed.status, lang)}${bed.note ? ' · ' + bed.note : ''}`}
                                onClick={() => openBed(bed, room)}
                              >
                                {bed.occupancy ? bed.occupancy.person.name.slice(0, 1) : dis ? '×' : bed.label.slice(0, 1)}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </Col>
                );
              })}
            </Row>
          )}

          {devices.length > 0 && (
            <>
              <Divider style={{ margin: '16px 0 10px' }} orientation="left" plain>{t('devices')}</Divider>
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

      {/* 房间抽屉 */}
      <Drawer open={!!roomDrawer} width={620} onClose={() => setRoomDrawer(null)}
        title={roomDrawer ? `${roomDrawer.code} · ${roomDrawer.roomType.nameZh}` : ''}>
        {roomDrawer && (
          <Space direction="vertical" style={{ width: '100%' }} size={14}>
            {roomDrawer.isDerated && (
              <Alert type="warning" showIcon
                message={`已降标：房型标称 ${roomDrawer.nominalCapacity} 人，实际按 ${roomDrawer.capacity} 人配置`}
                description={roomDrawer.deratedReason} />
            )}
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label={t('roomType')}>
                <Tag color={roomDrawer.roomType.color}>{roomDrawer.roomType.nameZh}</Tag>
                {roomDrawer.roomType.managementMode === 'HOTEL' && <Tag color="purple">酒店式</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label={t('status')}>
                {labelOf(ROOM_STATUS_LABEL, roomDrawer.status, lang)}
              </Descriptions.Item>
              <Descriptions.Item label={t('nominalCapacity')}>{roomDrawer.nominalCapacity}</Descriptions.Item>
              <Descriptions.Item label={t('capacity')}>
                <b style={{ color: roomDrawer.isDerated ? '#fa8c16' : undefined }}>{roomDrawer.capacity}</b>
              </Descriptions.Item>
              <Descriptions.Item label="物理床位">{roomDrawer.bedCount}</Descriptions.Item>
              <Descriptions.Item label="可用床位">{roomDrawer.usableBedCount}</Descriptions.Item>
              <Descriptions.Item label={t('facilities')} span={2}>
                <Space size={4} wrap>
                  {roomDrawer.hasAC && <Tag>空调</Tag>}
                  {roomDrawer.hasBathroom && <Tag>独立卫浴</Tag>}
                  {roomDrawer.hasWaterHeater && <Tag>热水器</Tag>}
                  {roomDrawer.hasBalcony && <Tag>阳台</Tag>}
                  {roomDrawer.orientation && <Tag>朝{roomDrawer.orientation}</Tag>}
                  {roomDrawer.area && <Tag>{Math.round(roomDrawer.area)} ㎡</Tag>}
                </Space>
              </Descriptions.Item>
            </Descriptions>

            <Space wrap>
              <Button size="small" type="primary" disabled={!roomDrawer.roomType.isResidential}
                onClick={() => { setCapModal(roomDrawer); setCapValue(roomDrawer.capacity); setCapReason(roomDrawer.deratedReason ?? ''); }}>
                {t('adjustCapacity')}
              </Button>
              <Button size="small" disabled={!roomDrawer.roomType.isResidential}
                onClick={async () => {
                  await api.extraBed({ roomId: roomDrawer.id, reason: '临时加床' });
                  message.success('已加床'); openRoom(roomDrawer.id); refresh();
                }}>{t('extraBed')}</Button>
              <Button size="small" onClick={async () => setQr(await api.roomQrCode(roomDrawer.id))}>
                门牌二维码
              </Button>
              <Select size="small" style={{ width: 130 }} value={roomDrawer.status}
                onChange={async (v) => {
                  try {
                    await api.updateRoom(roomDrawer.id, { status: v });
                    message.success('已更新'); openRoom(roomDrawer.id); refresh();
                  } catch (e: any) { message.error(e.message); }
                }}
                options={meta.roomStatuses.map((s: string) => ({ value: s, label: labelOf(ROOM_STATUS_LABEL, s, lang) }))} />
            </Space>

            {roomDrawer.assets?.length > 0 && (
              <Card size="small" title={t('assets')} styles={{ body: { padding: 0 } }}>
                <Table size="small" rowKey="id" pagination={false} dataSource={roomDrawer.assets}
                  columns={[
                    { title: '资产', dataIndex: 'name', width: 130 },
                    { title: '编号', dataIndex: 'assetNo', width: 150 },
                    { title: t('status'), dataIndex: 'status', width: 100,
                      render: (v) => <Tag color={v === 'NORMAL' ? 'green' : v === 'BROKEN' ? 'red' : 'orange'}>
                        {v === 'NORMAL' ? '正常' : v === 'BROKEN' ? '损坏' : v === 'REPAIRING' ? '维修中' : '报废'}</Tag> },
                  ]} />
              </Card>
            )}

            {roomDrawer.workOrders?.length > 0 && (
              <Card size="small" title={t('workOrder')} styles={{ body: { padding: 0 } }}>
                <Table size="small" rowKey="id" pagination={false} dataSource={roomDrawer.workOrders}
                  columns={[
                    { title: '单号', dataIndex: 'code', width: 110 },
                    { title: t('category'), dataIndex: 'category', width: 110 },
                    { title: '标题', dataIndex: 'title', ellipsis: true },
                    { title: t('status'), dataIndex: 'status', width: 100 },
                  ]} />
              </Card>
            )}
          </Space>
        )}
      </Drawer>

      {/* 床位抽屉 */}
      <Drawer open={!!bedDrawer} width={540} onClose={() => setBedDrawer(null)}
        title={bedDrawer ? `${bedDrawer.room.code} · ${bedDrawer.bed.label}` : ''}>
        {bedDrawer && (
          <Space direction="vertical" style={{ width: '100%' }} size={14}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label={t('bed')}>{bedDrawer.bed.code}</Descriptions.Item>
              <Descriptions.Item label="铺位">
                {labelOf(BED_POSITION_LABEL, bedDrawer.bed.position, lang)}
                {bedDrawer.bed.isExtra && <Tag color="gold" style={{ marginLeft: 4 }}>加床</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label={t('status')}>
                <Tag color={BED_STATUS_COLOR[bedDrawer.bed.status]}>{labelOf(BED_STATUS_LABEL, bedDrawer.bed.status, lang)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('roomType')}>{bedDrawer.room.roomType.nameZh}</Descriptions.Item>
              <Descriptions.Item label={t('capacity')} span={2}>
                {bedDrawer.room.capacity}
                {bedDrawer.room.isDerated && <Tag color="orange" style={{ marginLeft: 6 }}>
                  已降标（标称 {bedDrawer.room.nominalCapacity}）</Tag>}
              </Descriptions.Item>
              {bedDrawer.bed.note && <Descriptions.Item label="备注" span={2}>{bedDrawer.bed.note}</Descriptions.Item>}
            </Descriptions>

            {bedDrawer.bed.occupancy ? (
              <Card size="small" title={t('occupied')}>
                <Descriptions size="small" column={2}>
                  <Descriptions.Item label={t('name')}><b>{bedDrawer.bed.occupancy.person.name}</b></Descriptions.Item>
                  <Descriptions.Item label={t('employeeNo')}>{bedDrawer.bed.occupancy.person.employeeNo}</Descriptions.Item>
                  <Descriptions.Item label={t('personType')}>
                    <Tag color={bedDrawer.bed.occupancy.person.personType === 'DEPENDENT' ? 'magenta' : 'blue'}>
                      {labelOf(PERSON_TYPE_LABEL, bedDrawer.bed.occupancy.person.personType, lang)}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label={t('nationality')}>
                    <Tag color={bedDrawer.bed.occupancy.person.nationalityColor}>{bedDrawer.bed.occupancy.person.nationalityId}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label={t('department')}>{bedDrawer.bed.occupancy.person.department ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label={t('positionLevel')}>{bedDrawer.bed.occupancy.person.positionLevel ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label={t('shift')}>{bedDrawer.bed.occupancy.person.shift ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label={t('religion')}>
                    {bedDrawer.bed.occupancy.person.religion ?? '—'}
                    {bedDrawer.bed.occupancy.person.hasDietaryRule && <Tag color="green" style={{ marginLeft: 4 }}>有饮食禁忌</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('contractor')} span={2}>{bedDrawer.bed.occupancy.person.contractor ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="特殊标记" span={2}>
                    <Space size={4} wrap>
                      {bedDrawer.bed.occupancy.person.isSmoker && <Tag>吸烟</Tag>}
                      {bedDrawer.bed.occupancy.person.needsLowerBunk && <Tag color="orange">不能睡上铺</Tag>}
                      {bedDrawer.bed.occupancy.person.needsGroundFloor && <Tag color="red">需低楼层</Tag>}
                      {!bedDrawer.bed.occupancy.person.isSmoker && !bedDrawer.bed.occupancy.person.needsLowerBunk
                        && !bedDrawer.bed.occupancy.person.needsGroundFloor && '无'}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label={t('checkInAt')} span={2}>
                    {new Date(bedDrawer.bed.occupancy.checkInAt).toLocaleDateString()}
                  </Descriptions.Item>
                </Descriptions>
                {bedDrawer.bed.occupancy.person.employmentStatus === 'RESIGNED' && (
                  <Alert type="error" showIcon style={{ marginTop: 8 }}
                    message="该人员已离职，床位未释放" description="请办理退宿，否则空床数据会持续失真。" />
                )}
                <Space style={{ marginTop: 12 }} wrap>
                  <Button danger size="small" onClick={() => doCheckout(bedDrawer.bed.occupancy.person.id)}>{t('checkout')}</Button>
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
                  <Typography.Text type="secondary">
                    {bedDrawer.bed.status === 'DISABLED'
                      ? '该床位已按降标撤除。要恢复请到房间里调高核定人数。'
                      : labelOf(BED_STATUS_LABEL, bedDrawer.bed.status, lang)}
                  </Typography.Text>
                  <Space>
                    <Button type="primary" size="small" disabled={bedDrawer.bed.status !== 'FREE'}
                      onClick={() => setAssignFor({ bedId: bedDrawer.bed.id })}>{t('assign')}</Button>
                    {bedDrawer.bed.status === 'FREE' && (
                      <Button size="small" onClick={async () => {
                        await api.setBedStatus(bedDrawer.bed.id, { status: 'MAINTENANCE', note: '床位报修' });
                        message.success('已标记维修'); setBedDrawer(null); refresh();
                      }}>标记维修</Button>
                    )}
                    {['MAINTENANCE', 'LOCKED'].includes(bedDrawer.bed.status) && (
                      <Button size="small" onClick={async () => {
                        await api.setBedStatus(bedDrawer.bed.id, { status: 'FREE' });
                        message.success('已恢复可用'); setBedDrawer(null); refresh();
                      }}>恢复可用</Button>
                    )}
                  </Space>
                </Space>
              </Card>
            )}

            <Card size="small" title={t('history')} styles={{ body: { padding: 0 } }}>
              <Table
                size="small" rowKey="id" pagination={false} dataSource={bedHistory}
                locale={{ emptyText: '无历史记录' }}
                columns={[
                  { title: t('name'), dataIndex: ['person', 'name'],
                    render: (v, r: any) => <span>{v}<br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.person.employeeNo}</span></span> },
                  { title: t('department'), dataIndex: ['person', 'department'], width: 110 },
                  { title: '住宿区间', width: 150, render: (_: any, r: any) =>
                      `${new Date(r.checkInAt).toLocaleDateString()} → ${r.checkOutAt ? new Date(r.checkOutAt).toLocaleDateString() : '至今'}` },
                ]}
              />
              <div style={{ padding: '6px 10px', fontSize: 11, color: '#8c8c8c' }}>
                时间区间模型：这张床历史上住过谁全部可查，事故追溯 / 密接排查时用得上。
              </div>
            </Card>
          </Space>
        )}
      </Drawer>

      {/* 调整核定人数 */}
      <Modal
        open={!!capModal} title={t('adjustCapacity')} onCancel={() => setCapModal(null)}
        onOk={async () => {
          try {
            await api.setRoomCapacity(capModal.id, { capacity: capValue, deratedReason: capReason || null });
            message.success('已调整，多余空床已自动撤除');
            setCapModal(null); openRoom(capModal.id); refresh();
          } catch (e: any) { message.error(e.message); }
        }}
      >
        {capModal && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert type="info" showIcon
              message={`${capModal.code} · ${capModal.roomType.nameZh}（房型标称 ${capModal.nominalCapacity} 人）`}
              description="调低核定人数后，多出来的空床会自动标记为「降标撤除」，不会再被排人进去；调高则恢复。已经住人的床不会被动。" />
            <div>
              <span style={{ marginRight: 8 }}>{t('capacity')}：</span>
              <InputNumber min={0} max={capModal.nominalCapacity + 4} value={capValue} onChange={(v) => setCapValue(v ?? 0)} />
              <span style={{ marginLeft: 8, color: '#8c8c8c' }}>
                标称 {capModal.nominalCapacity} · 当前在住 {capModal.beds.filter((b: any) => b.occupancy).length}
              </span>
            </div>
            <Input placeholder="降标原因（如：空调制冷量不足 / 面积偏小 / 主管批准）"
              value={capReason} onChange={(e) => setCapReason(e.target.value)} />
          </Space>
        )}
      </Modal>

      {/* 单间门牌二维码 */}
      <Modal
        open={!!qr} title={qr ? `${qr.roomCode} 门牌二维码` : ''} onCancel={() => setQr(null)}
        footer={<Button type="primary" onClick={() => window.print()}>打印</Button>}
      >
        {qr && (
          <div style={{ textAlign: 'center' }}>
            <Alert type="info" showIcon style={{ marginBottom: 12, textAlign: 'left' }}
              message="贴在房门上，员工扫码直接进自助端"
              description="扫码后看到房间信息并可一键报修。二维码里的地址取自「设置 → 阈值 → 自助端基址」，上线前记得填成园区内网地址。" />
            <img src={qr.dataUrl} alt={qr.roomCode} style={{ width: 240, height: 240 }} />
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>{qr.roomCode}</div>
            <div style={{ color: '#8c8c8c', fontSize: 12 }}>
              {qr.building}栋 {qr.floorLevel}层 · {qr.roomType}
            </div>
            <div style={{ color: '#bfbfbf', fontSize: 11, marginTop: 8, wordBreak: 'break-all' }}>{qr.url}</div>
          </div>
        )}
      </Modal>

      {/* 整层批量打印 */}
      <Modal
        open={!!floorQrs} width={860} onCancel={() => setFloorQrs(null)}
        title={`${building?.code}栋 ${floor?.name} · 门牌二维码`}
        footer={<Button type="primary" onClick={() => window.print()}>打印本页</Button>}
      >
        <Row gutter={[12, 12]}>
          {(floorQrs ?? []).filter((q: any) => q.isResidential).map((q: any) => (
            <Col key={q.roomId} span={6} style={{ textAlign: 'center' }}>
              <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
                <img src={q.dataUrl} alt={q.roomCode} style={{ width: '100%' }} />
                <div style={{ fontWeight: 700 }}>{q.roomCode}</div>
                <div style={{ fontSize: 11, color: '#8c8c8c' }}>{q.roomType}</div>
              </div>
            </Col>
          ))}
        </Row>
      </Modal>

      <AssignDrawer
        bedId={assignFor?.bedId ?? null}
        onClose={() => setAssignFor(null)}
        onDone={() => { setAssignFor(null); setBedDrawer(null); refresh(); }}
      />
    </Row>
  );

  async function doCheckout(personId: number) {
    const run = async (settleItems: boolean) => {
      try {
        await api.checkout({ personId, reason: '宿管办理退宿', settleItems });
        message.success('已退宿');
        setBedDrawer(null); refresh();
      } catch (e: any) {
        if (e.status === 409 && e.body?.pendingItems) {
          modal.confirm({
            title: '还有未归还物品',
            width: 520,
            content: (
              <div>
                <p style={{ margin: '8px 0' }}>退宿前需要清点以下物品：</p>
                <ul style={{ paddingLeft: 18 }}>
                  {e.body.pendingItems.map((i: any) => (
                    <li key={i.id}>{i.name} × {i.quantity}（单价 ¥{i.price}）</li>
                  ))}
                </ul>
                <p style={{ marginTop: 8, color: '#8c8c8c' }}>确认已当场清点完毕并全部收回后再继续。</p>
              </div>
            ),
            okText: '已清点，继续退宿',
            cancelText: '先去清点',
            onOk: () => run(true),
          });
        } else message.error(e.message);
      }
    };
    await run(false);
  }
}
