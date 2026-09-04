import { useEffect, useMemo, useState } from 'react';
import { Card, Segmented, Select, Space, Tag, Spin, Tooltip, Typography, Empty, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { useMeta } from '../meta';
import BuildingTowers from './BuildingTowers';

/**
 * 楼层平面图。
 *
 * 没有真实的建筑图纸坐标，所以按园区宿舍最常见的形制生成：
 * 一条中间走廊，房间分列两侧（单号一侧、双号一侧），楼梯在走廊一端。
 * 功能房（洗衣房 / 祷告室 / 宿管室）单独标出来，不算住宿房间。
 *
 * 房间格子里画出真实的床位小格 —— 宿管扫一眼就知道哪张床空着，
 * 不用点进去。
 */

type Mode = 'rate' | 'nationality' | 'roomType';

function rateColor(rate: number, occupied: number) {
  if (occupied === 0) return '#fafafa';
  if (rate >= 1) return '#ffccc7';
  if (rate >= 0.9) return '#ffe7ba';
  if (rate >= 0.6) return '#f6ffed';
  return '#f0f5ff';
}

const BED_DOT: Record<string, string> = {
  OCCUPIED: '#1677ff', HELD: '#722ed1', RESERVED: '#faad14',
  FREE: '#ffffff', MAINTENANCE: '#ff7875', LOCKED: '#8c8c8c', DISABLED: '#e8e8e8',
};

export default function FloorPlan() {
  const t = useT();
  const meta = useMeta();
  const nav = useNavigate();
  const [tree, setTree] = useState<any[] | null>(null);
  const [buildingId, setBuildingId] = useState<number | null>(null);
  const [floorId, setFloorId] = useState<number | null>(null);
  const [floor, setFloor] = useState<any>(null);
  const [mode, setMode] = useState<Mode>('rate');
  const [view, setView] = useState<'plan' | 'tower'>('plan');

  useEffect(() => { api.tree().then(setTree); }, []);
  useEffect(() => {
    if (!tree?.length) return;
    const b = tree[0];
    setBuildingId(b.id);
    setFloorId(b.floors[0]?.id ?? null);
  }, [tree]);
  useEffect(() => { if (floorId) api.floor(floorId).then(setFloor); }, [floorId]);

  const building = useMemo(() => tree?.find((b) => b.id === buildingId), [tree, buildingId]);

  /** 按房号奇偶分到走廊两侧，功能房拎出来单独放 */
  const sides = useMemo(() => {
    const rooms = floor?.rooms ?? [];
    const living = rooms.filter((r: any) => r.roomType.isResidential);
    const func = rooms.filter((r: any) => !r.roomType.isResidential);
    const north: any[] = [];
    const south: any[] = [];
    living.forEach((r: any, i: number) => (i % 2 === 0 ? north : south).push(r));
    return { north, south, func };
  }, [floor]);

  if (!tree) return <Card size="small" title="楼层平面图"><Spin /></Card>;
  if (!tree.length) return <Card size="small" title="楼层平面图"><Empty /></Card>;

  const roomFill = (r: any) => {
    const occupied = r.beds.filter((b: any) => b.occupancy).length;
    if (mode === 'roomType') return r.roomType.color + '55';
    if (mode === 'nationality') {
      const nat = r.effectiveNationality;
      const c = nat ? meta.nationalities.find((n: any) => n.id === nat)?.color : null;
      return c ? c + '33' : '#fafafa';
    }
    const usable = r.beds.filter((b: any) => !['DISABLED', 'MAINTENANCE', 'LOCKED'].includes(b.status)).length;
    return rateColor(usable ? occupied / usable : 0, occupied);
  };

  const RoomBox = ({ r }: { r: any }) => {
    const occupied = r.beds.filter((b: any) => b.occupancy).length;
    const out = r.status !== 'AVAILABLE';
    return (
      <Tooltip
        title={
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <b>{r.code} · {r.roomType.nameZh}</b><br />
            在住 {occupied} / 核定 {r.capacity}
            {r.isDerated && <>（房型标称 {r.nominalCapacity}，已降标）</>}<br />
            {r.deratedReason && <>降标原因：{r.deratedReason}<br /></>}
            状态：{r.status}
            {r.effectiveNationality && <> · 归属 {r.effectiveNationality}</>}<br />
            设施：{[r.hasAC && '空调', r.hasBathroom && '独卫', r.hasWaterHeater && '热水', r.hasBalcony && '阳台']
              .filter(Boolean).join(' / ') || '—'}<br />
            {r.beds.filter((b: any) => b.occupancy).map((b: any) => b.occupancy.person.name).join('、') || '无人'}
          </div>
        }
      >
        <div
          className={`plan-room${out ? ' is-out' : ''}`}
          style={{ background: roomFill(r) }}
          onClick={() => nav(`/beds?building=${buildingId}&floor=${floorId}`)}
        >
          <div className="plan-room-head">
            <b>{r.code.split('-')[1] ?? r.code}</b>
            <span>{occupied}/{r.capacity}</span>
          </div>
          <div className="plan-room-type" style={{ color: r.roomType.color }}>
            {r.roomType.nameZh}
            {r.isDerated && <span className="plan-flag">降</span>}
            {out && <span className="plan-flag danger">修</span>}
          </div>
          <div className="plan-beds">
            {r.beds.map((b: any) => (
              <i key={b.id}
                style={{
                  background: b.occupancy ? BED_DOT[b.status] ?? '#1677ff' : BED_DOT[b.status] ?? '#fff',
                  borderStyle: b.status === 'FREE' ? 'dashed' : 'solid',
                }} />
            ))}
          </div>
        </div>
      </Tooltip>
    );
  };

  const FuncBox = ({ r }: { r: any }) => (
    <Tooltip title={`${r.code} · ${r.roomType.nameZh}（功能房，不住人）`}>
      <div className="plan-room is-func">
        <div className="plan-room-head"><b>{r.code.split('-')[1] ?? r.code}</b></div>
        <div className="plan-func-name">{r.roomType.nameZh}</div>
      </div>
    </Tooltip>
  );

  const stats = floor
    ? (() => {
        const living = floor.rooms.filter((r: any) => r.roomType.isResidential);
        const beds = living.flatMap((r: any) => r.beds);
        return {
          rooms: living.length,
          capacity: living.reduce((s: number, r: any) => s + r.capacity, 0),
          occupied: beds.filter((b: any) => b.occupancy).length,
          free: beds.filter((b: any) => b.status === 'FREE').length,
          derated: living.filter((r: any) => r.isDerated).length,
        };
      })()
    : null;

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <span>楼层平面图</span>
          {building && stats && (
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              {building.code}栋 {floor?.name} · 住宿房 {stats.rooms} 间 · 核定 {stats.capacity} 人 ·
              在住 {stats.occupied} · 空床 {stats.free}
              {stats.derated > 0 && ` · 降标 ${stats.derated} 间`}
            </Typography.Text>
          )}
        </Space>
      }
      extra={
        <Space>
          <Segmented size="small" value={view} onChange={(v) => setView(v as any)}
            options={[{ label: '平面图', value: 'plan' }, { label: '楼栋剖面', value: 'tower' }]} />
          {view === 'plan' && (
            <Segmented
              size="small" value={mode} onChange={(v) => setMode(v as Mode)}
              options={[
                { label: t('occupancyRate'), value: 'rate' },
                { label: t('nationality'), value: 'nationality' },
                { label: t('roomType'), value: 'roomType' },
              ]}
            />
          )}
        </Space>
      }
    >
      {view === 'tower' ? <BuildingTowers embedded /> : (
        <div className="plan-wrap">
          {/* 左：楼栋 + 楼层（从下往上，跟真楼一致） */}
          <div className="plan-side">
            <Select
              size="small" style={{ width: '100%', marginBottom: 8 }}
              value={buildingId ?? undefined}
              onChange={(v) => {
                setBuildingId(v);
                const b = tree.find((x) => x.id === v);
                setFloorId(b?.floors[0]?.id ?? null);
              }}
              options={tree.map((b) => ({ value: b.id, label: `${b.code} · ${b.name.replace(/^.栋\s*/, '')}` }))}
            />
            <div className="plan-floors">
              {[...(building?.floors ?? [])].reverse().map((f: any) => {
                const used = f.stats.occupied + f.stats.held;
                const denom = Math.max(f.stats.total - f.stats.disabled - f.stats.maintenance, 1);
                return (
                  <div key={f.id}
                    className={`plan-floor-btn${f.id === floorId ? ' active' : ''}`}
                    onClick={() => setFloorId(f.id)}>
                    <b>{f.level}F</b>
                    {f.nationalityId && (
                      <Tag color={f.nationalityColor}
                        style={{ fontSize: 10, lineHeight: '15px', padding: '0 4px', marginInlineEnd: 0 }}>
                        {f.nationalityId}
                      </Tag>
                    )}
                    <span className="plan-floor-num">{used}/{denom}</span>
                  </div>
                );
              })}
            </div>
            <Button size="small" block style={{ marginTop: 8 }}
              onClick={() => nav(`/beds?building=${buildingId}&floor=${floorId}`)}>
              打开床位图
            </Button>
          </div>

          {/* 右：平面图本体 */}
          <div className="plan-body">
            {!floor ? <Spin /> : (
              <div className="plan-canvas">
                <div className="plan-row">
                  {sides.north.map((r: any) => <RoomBox key={r.id} r={r} />)}
                </div>

                <div className="plan-corridor">
                  <span className="plan-stair">楼梯 / 电梯</span>
                  <span className="plan-corridor-label">
                    走　廊　{building?.code}栋 {floor.level} 层
                  </span>
                  <span className="plan-stair">安全出口</span>
                </div>

                <div className="plan-row">
                  {sides.south.map((r: any) => <RoomBox key={r.id} r={r} />)}
                </div>

                {sides.func.length > 0 && (
                  <div className="plan-func-row">
                    <span className="plan-func-label">功能房</span>
                    {sides.func.map((r: any) => <FuncBox key={r.id} r={r} />)}
                  </div>
                )}
              </div>
            )}

            <div className="legend" style={{ marginTop: 12 }}>
              <span style={{ color: '#8c8c8c' }}>床位：</span>
              <span><i className="dot" style={{ background: BED_DOT.OCCUPIED }} />在住</span>
              <span><i className="dot" style={{ background: BED_DOT.HELD }} />休假保留</span>
              <span><i className="dot" style={{ background: '#fff', border: '1px dashed #d9d9d9' }} />空床</span>
              <span><i className="dot" style={{ background: BED_DOT.MAINTENANCE }} />维修</span>
              <span><i className="dot" style={{ background: BED_DOT.DISABLED }} />降标撤除</span>
              {mode === 'rate' && (
                <>
                  <span style={{ color: '#8c8c8c', marginLeft: 8 }}>房间底色：</span>
                  <span><i className="dot" style={{ background: '#fafafa', border: '1px solid #eee' }} />空房</span>
                  <span><i className="dot" style={{ background: '#f0f5ff' }} />宽松</span>
                  <span><i className="dot" style={{ background: '#f6ffed' }} />较满</span>
                  <span><i className="dot" style={{ background: '#ffe7ba' }} />接近满</span>
                  <span><i className="dot" style={{ background: '#ffccc7' }} />已满</span>
                </>
              )}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              走廊两侧排布，楼梯在一端 —— 房间格子里的小方块就是真实床位，悬停看住户，点击进床位图。
            </Typography.Text>
          </div>
        </div>
      )}
    </Card>
  );
}
