import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Alert, Button, Spin, Tag, Space, Result } from 'antd';
import { selfApi } from './selfApi';
import { useSelfT } from './selfI18n';

/**
 * 扫房门二维码的落地页。
 * 二维码贴在门上谁都能扫，所以这里只显示房间的公开信息 ——
 * 不列住户名单，只告诉你「是不是你住的房间」，然后一键报修。
 */
export default function SelfRoom() {
  const { code } = useParams();
  const nav = useNavigate();
  const { t, lang, dict } = useSelfT();
  const [room, setRoom] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    selfApi.room(code).then(setRoom).catch((e) => setErr(e.message));
  }, [code]);

  if (err) return <Result status="404" title={err} extra={<Button onClick={() => nav('/m')}>{t('navHome')}</Button>} />;
  if (!room) return <div className="self-center"><Spin size="large" /></div>;

  return (
    <div>
      <div className="self-room-hero">
        <div className="self-room-code">{room.roomCode}</div>
        <div className="self-room-where">
          {lang === 'zh' ? room.buildingName : `${lang === 'id' ? 'Gedung' : 'Block'} ${room.buildingCode}`}
          {' · '}{lang === 'zh' ? `${room.floorLevel}F` : `${lang === 'id' ? 'Lantai' : 'Floor'} ${room.floorLevel}`}
          {' · '}{dict(room.roomType)}
        </div>
      </div>

      <Alert
        type={room.isMine ? 'success' : 'info'} showIcon style={{ marginBottom: 12 }}
        message={room.isMine ? t('scanMine') : t('scanNotMine')}
      />

      <div className="self-card">
        <div className="self-card-title">{t('facilities')}</div>
        <Space size={6} wrap>
          {room.hasAC && <Tag color="blue">{t('ac')}</Tag>}
          {room.hasBathroom && <Tag color="blue">{t('bathroom')}</Tag>}
          {room.hasWaterHeater && <Tag color="blue">{t('waterHeater')}</Tag>}
          {!room.hasAC && !room.hasBathroom && !room.hasWaterHeater && <span style={{ color: '#bfbfbf' }}>—</span>}
        </Space>
        {room.openWorkOrders > 0 && (
          <div className="self-kv" style={{ marginTop: 8 }}>
            <span className="k">{t('openWorkOrders')}</span>
            <span className="v"><Tag color="orange">{room.openWorkOrders}</Tag></span>
          </div>
        )}
      </div>

      <Button type="primary" size="large" block onClick={() => nav('/m/repair')}>
        🔧 {t('reportRepair')}
      </Button>
      <Button size="large" block style={{ marginTop: 10 }} onClick={() => nav('/m')}>
        {t('navHome')}
      </Button>
    </div>
  );
}
