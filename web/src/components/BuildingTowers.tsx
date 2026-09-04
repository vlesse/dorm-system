import { useEffect, useState } from 'react';
import { Card, Segmented, Space, Tag, Spin, Tooltip, Typography, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { useMeta } from '../meta';

/**
 * 楼栋剖面图。
 *
 * 把 8 栋楼画成 8 座「塔」，楼层从下往上堆 —— 跟真实楼一个方向，
 * 宿管看一眼就知道哪层满了、哪层空、哪层住的是谁。
 *
 * 三种着色口径：
 *   入住率  热力图，一眼找出爆满和空置的楼层
 *   国籍分区 中方 / 印尼籍 / 不限，验证分区是不是按计划走的
 *   房型构成 每层画成房型色带，看得出这层是八人间还是干部房
 */

type Mode = 'rate' | 'nationality' | 'roomType';

/** 入住率热力色阶 —— 越红越挤 */
function rateColor(rate: number) {
  if (rate >= 0.98) return '#ff7875';
  if (rate >= 0.9) return '#ffa940';
  if (rate >= 0.75) return '#ffd666';
  if (rate >= 0.5) return '#95de64';
  if (rate > 0) return '#b7eb8f';
  return '#f0f0f0';
}

export default function BuildingTowers() {
  const t = useT();
  const meta = useMeta();
  const nav = useNavigate();
  const [tree, setTree] = useState<any[] | null>(null);
  const [mode, setMode] = useState<Mode>('rate');

  useEffect(() => { api.tree().then(setTree); }, []);

  if (!tree) return <Card size="small" title="楼栋剖面"><Spin /></Card>;
  if (tree.length === 0) return <Card size="small" title="楼栋剖面"><Empty /></Card>;

  const floorUsage = (f: any) => {
    const used = f.stats.occupied + f.stats.held;
    const denom = Math.max(f.stats.total - f.stats.disabled - f.stats.maintenance, 0);
    return { used, denom, rate: denom ? used / denom : 0 };
  };

  const natColor = (id: string | null) =>
    id ? (meta.nationalities.find((n: any) => n.id === id)?.color ?? '#d9d9d9') : '#f0f0f0';

  return (
    <Card
      size="small"
      title="楼栋剖面 · 每层住了多少人"
      extra={
        <Segmented
          size="small" value={mode} onChange={(v) => setMode(v as Mode)}
          options={[
            { label: t('occupancyRate'), value: 'rate' },
            { label: t('nationality'), value: 'nationality' },
            { label: t('roomType'), value: 'roomType' },
          ]}
        />
      }
    >
      <div className="towers">
        {tree.map((b) => {
          const bUsed = b.stats.occupied + b.stats.held;
          const bDenom = Math.max(b.stats.total - b.stats.disabled - b.stats.maintenance, 1);
          return (
            <div className="tower" key={b.id}>
              {/* 楼层从下往上堆，1F 在底 */}
              <div className="tower-floors">
                {[...b.floors].reverse().map((f: any) => {
                  const { used, denom, rate } = floorUsage(f);
                  const residentialMix = (f.roomTypeMix ?? []).filter((x: any) => x.isResidential);
                  const mixTotal = residentialMix.reduce((s: number, x: any) => s + x.rooms, 0) || 1;

                  const tip = (
                    <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                      <b>{b.code}栋 {f.level} 层</b><br />
                      在住 {f.stats.occupied} · 保留 {f.stats.held} · 空床 {f.stats.free}<br />
                      可用床位 {denom}，入住率 {(rate * 100).toFixed(0)}%<br />
                      房间 {f.roomCount}（功能房 {f.functionRoomCount}）
                      {f.deratedRoomCount > 0 && <> · 降标 {f.deratedRoomCount} 间</>}<br />
                      国籍分区：{f.nationalityId ?? '跟随楼栋'}<br />
                      {residentialMix.map((x: any) => `${x.name}×${x.rooms}`).join('、')}
                    </div>
                  );

                  return (
                    <Tooltip key={f.id} title={tip} placement="right">
                      <div
                        className="tower-floor"
                        onClick={() => nav(`/beds?building=${b.id}&floor=${f.id}`)}
                        style={mode === 'roomType' ? undefined : {
                          background: mode === 'rate' ? rateColor(rate) : natColor(f.nationalityId ?? b.nationalityId),
                        }}
                      >
                        {mode === 'roomType' && (
                          <div className="tower-mix">
                            {residentialMix.map((x: any) => (
                              <i key={x.code} style={{ width: `${(x.rooms / mixTotal) * 100}%`, background: x.color }} />
                            ))}
                          </div>
                        )}
                        <span className="tower-floor-no">{f.level}</span>
                        <span className="tower-floor-num">{used}/{denom}</span>
                        {/* 入住率模式下再叠一根实心条，满没满一眼看到 */}
                        {mode === 'rate' && (
                          <span className="tower-floor-bar" style={{ width: `${Math.min(rate, 1) * 100}%` }} />
                        )}
                      </div>
                    </Tooltip>
                  );
                })}
              </div>

              <div className="tower-base" onClick={() => nav(`/beds?building=${b.id}`)}>
                <div className="tower-code">{b.code}</div>
                <div className="tower-meta">
                  {bUsed}/{bDenom}
                  <br />
                  <span style={{ color: '#8c8c8c' }}>{((bUsed / bDenom) * 100).toFixed(0)}%</span>
                </div>
                <Space size={2} wrap style={{ justifyContent: 'center', marginTop: 4 }}>
                  {b.nationalityId
                    ? <Tag color={b.nationalityColor} style={{ fontSize: 10, lineHeight: '15px', padding: '0 4px', marginInlineEnd: 0 }}>{b.nationalityId}</Tag>
                    : <Tag style={{ fontSize: 10, lineHeight: '15px', padding: '0 4px', marginInlineEnd: 0 }}>混</Tag>}
                  {b.genderPolicy !== 'MIXED' && (
                    <Tag style={{ fontSize: 10, lineHeight: '15px', padding: '0 4px', marginInlineEnd: 0 }}>
                      {b.genderPolicy === 'MALE' ? '男' : '女'}
                    </Tag>
                  )}
                </Space>
              </div>
            </div>
          );
        })}
      </div>

      {/* 图例 */}
      <div className="legend" style={{ marginTop: 14 }}>
        {mode === 'rate' && (
          <>
            <span><i className="dot" style={{ background: '#f0f0f0' }} />空置</span>
            <span><i className="dot" style={{ background: '#b7eb8f' }} />&lt;50%</span>
            <span><i className="dot" style={{ background: '#95de64' }} />50-75%</span>
            <span><i className="dot" style={{ background: '#ffd666' }} />75-90%</span>
            <span><i className="dot" style={{ background: '#ffa940' }} />90-98%</span>
            <span><i className="dot" style={{ background: '#ff7875' }} />≥98% 已满</span>
          </>
        )}
        {mode === 'nationality' && (
          <>
            {meta.nationalities.map((n: any) => (
              <span key={n.id}><i className="dot" style={{ background: n.color }} />{n.nameZh}</span>
            ))}
            <span><i className="dot" style={{ background: '#f0f0f0' }} />不限</span>
          </>
        )}
        {mode === 'roomType' && meta.roomTypes.filter((r: any) => r.isResidential).map((r: any) => (
          <span key={r.id}><i className="dot" style={{ background: r.color }} />{r.nameZh}</span>
        ))}
      </div>

      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
        楼层从下往上排，跟真实楼一致。鼠标悬停看该层明细，点击直接跳到床位图。
      </Typography.Text>
    </Card>
  );
}
