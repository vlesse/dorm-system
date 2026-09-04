import { Tag, Space, Alert, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useSelf } from './SelfApp';
import { useSelfT } from './selfI18n';

/** 我的住宿 —— 员工进来第一眼要看到的：我住哪、几号床、室友是谁 */
export default function SelfHome() {
  const { profile } = useSelf();
  const { t, lang, dict, bed } = useSelfT();
  const nav = useNavigate();
  const a = profile.accommodation;
  const p = profile.person;

  return (
    <div>
      {p.idExpiryInDays !== null && p.idExpiryInDays <= 90 && (
        <Alert
          type={p.idExpiryInDays <= 0 ? 'error' : 'warning'} showIcon
          style={{ marginBottom: 12 }}
          message={
            p.idExpiryInDays <= 0
              ? `${t('idExpiry')}：${t('expired')}`
              : `${t('idExpiry')}：${p.idExpiryInDays} ${t('daysLeft')}`
          }
        />
      )}

      {a ? (
        <div className="self-room-hero">
          <div className="self-room-code">{a.roomCode}</div>
          <div className="self-room-where">
            {lang === 'zh' ? a.buildingName : `${lang === 'id' ? 'Gedung' : 'Block'} ${a.buildingCode}`}
            {' · '}{lang === 'zh' ? `${a.floorLevel}F` : `${lang === 'id' ? 'Lantai' : 'Floor'} ${a.floorLevel}`}
            {' · '}{dict(a.roomType)}
          </div>
          <div className="self-room-bed">🛏 {bed(a.bedPosition, a.bedNo)}</div>
        </div>
      ) : (
        <div className="self-card">
          <Empty description={t('noRoom')} />
        </div>
      )}

      {a && (
        <>
          <div className="self-card">
            <div className="self-card-title">{t('facilities')}</div>
            <Space size={6} wrap>
              {a.hasAC && <Tag color="blue">{t('ac')}</Tag>}
              {a.hasBathroom && <Tag color="blue">{t('bathroom')}</Tag>}
              {a.hasWaterHeater && <Tag color="blue">{t('waterHeater')}</Tag>}
              {a.hasBalcony && <Tag color="blue">{t('balcony')}</Tag>}
              {!a.hasAC && !a.hasBathroom && !a.hasWaterHeater && !a.hasBalcony && (
                <span style={{ color: '#bfbfbf', fontSize: 13 }}>—</span>
              )}
            </Space>
            <div className="self-kv" style={{ marginTop: 8 }}>
              <span className="k">{t('checkInAt')}</span>
              <span className="v">{new Date(a.checkInAt).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="self-card">
            <div className="self-card-title">
              {t('roommates')}
              <span style={{ color: '#bfbfbf' }}>{profile.roommates.length} / {a.capacity - 1}</span>
            </div>
            {profile.roommates.length === 0 ? (
              <div className="self-empty">—</div>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={0}>
                {profile.roommates.map((r: any) => (
                  <div className="self-kv" key={r.id}>
                    <span className="k">{bed(r.bedPosition, r.bedNo)}</span>
                    <span className="v">
                      {r.name} <Tag style={{ marginLeft: 4 }}>{r.nationalityId}</Tag>
                    </span>
                  </div>
                ))}
              </Space>
            )}
          </div>
        </>
      )}

      <div className="self-card">
        <div className="self-card-title">{lang === 'zh' ? '我的信息' : lang === 'id' ? 'Info Saya' : 'My Info'}</div>
        <div className="self-kv"><span className="k">{t('employeeNo')}</span><span className="v">{p.employeeNo}</span></div>
        {p.department && <div className="self-kv"><span className="k">{lang === 'zh' ? '部门' : lang === 'id' ? 'Departemen' : 'Department'}</span><span className="v">{dict(p.department)}</span></div>}
        {p.shift && <div className="self-kv"><span className="k">{lang === 'zh' ? '班次' : lang === 'id' ? 'Sif' : 'Shift'}</span><span className="v">{dict(p.shift)}</span></div>}
        {p.nextLeaveDue && (
          <div className="self-kv">
            <span className="k">{t('nextLeave')}</span>
            <span className="v">
              {new Date(p.nextLeaveDue).toLocaleDateString()}
              <Tag color={p.leaveDueInDays <= 0 ? 'red' : p.leaveDueInDays <= 30 ? 'orange' : 'default'}
                style={{ marginLeft: 6 }}>
                {p.leaveDueInDays <= 0 ? t('expired') : `${p.leaveDueInDays} ${t('daysLeft')}`}
              </Tag>
            </span>
          </div>
        )}
      </div>

      <Space style={{ width: '100%' }} size={10}>
        <button className="self-card" style={{ flex: 1, border: 0, cursor: 'pointer', textAlign: 'center', font: 'inherit' }}
          onClick={() => nav('/m/repair')}>
          <div style={{ fontSize: 22 }}>🔧</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{t('reportRepair')}</div>
        </button>
        <button className="self-card" style={{ flex: 1, border: 0, cursor: 'pointer', textAlign: 'center', font: 'inherit' }}
          onClick={() => nav('/m/request')}>
          <div style={{ fontSize: 22 }}>📝</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{t('newRequest')}</div>
        </button>
      </Space>
    </div>
  );
}
