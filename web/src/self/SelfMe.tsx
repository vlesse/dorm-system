import { useEffect, useState } from 'react';
import { Tabs, Tag, Badge, Button, Empty, Spin, Space, Popconfirm } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { selfApi } from './selfApi';
import { useSelfT } from './selfI18n';
import { useSelf } from './SelfApp';

/** 我的：通知、公告、领用物品、押金、违规记录 */
export default function SelfMe() {
  const { profile, reload, logout } = useSelf();
  const { t, lang, dict } = useSelfT();
  const [notis, setNotis] = useState<any[] | null>(null);
  const [anns, setAnns] = useState<any[] | null>(null);

  useEffect(() => {
    selfApi.notifications().then(setNotis);
    selfApi.announcements().then(setAnns);
  }, []);

  const pickTitle = (a: any) =>
    lang === 'zh' ? a.title : lang === 'id' ? (a.titleId ?? a.title) : (a.titleEn ?? a.title);
  const pickContent = (a: any) =>
    lang === 'zh' ? a.content : lang === 'id' ? (a.contentId ?? a.content) : (a.contentEn ?? a.content);

  const notiPane = notis === null ? <div className="self-center"><Spin /></div>
    : notis.length === 0 ? <Empty description="—" />
    : notis.map((n) => (
      <div className="self-row" key={n.id}
        style={{ background: n.readAt ? '#fff' : '#f0f7ff', cursor: n.readAt ? undefined : 'pointer' }}
        onClick={async () => {
          if (!n.readAt) { await selfApi.readNotification(n.id); selfApi.notifications().then(setNotis); reload(); }
        }}>
        <div className="self-row-top">
          <div className="self-row-title">
            {!n.readAt && <Badge status="processing" style={{ marginRight: 6 }} />}
            {n.title}
          </div>
        </div>
        <div className="self-row-meta">{n.body}<br />{new Date(n.createdAt).toLocaleString()}</div>
      </div>
    ));

  const annPane = anns === null ? <div className="self-center"><Spin /></div>
    : anns.length === 0 ? <Empty description="—" />
    : anns.map((a) => (
      <div className="self-row" key={a.id}>
        <div className="self-row-top">
          <div className="self-row-title">{pickTitle(a)}</div>
          <Tag color={a.level === 'URGENT' ? 'red' : a.level === 'WARNING' ? 'orange' : 'blue'}>
            {a.level === 'URGENT' ? '!' : a.level === 'WARNING' ? '⚠' : 'i'}
          </Tag>
        </div>
        <div className="self-row-meta">
          {pickContent(a)}<br />
          {a.publishedBy} · {new Date(a.publishedAt).toLocaleDateString()}
        </div>
      </div>
    ));

  const itemsPane = (
    <>
      <div className="self-card">
        <div className="self-kv">
          <span className="k">{t('deposit')}</span>
          <span className="v">Rp {profile.depositTotal.toLocaleString()}</span>
        </div>
      </div>
      {profile.items.length === 0 ? <Empty description="—" /> : (
        <div className="self-card">
          <div className="self-card-title">{t('myItems')}</div>
          {profile.items.map((i: any) => (
            <div className="self-kv" key={i.id}>
              <span className="k">{dict(i)} × {i.quantity}</span>
              <span className="v">
                {i.returnedAt
                  ? <Tag color="green">{t('returned')}</Tag>
                  : <Tag color="blue">{t('notReturned')}</Tag>}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const vioPane = profile.violations.length === 0
    ? <Empty description={t('noViolations')} />
    : (
      <>
        <div className="self-card">
          <div className="self-kv">
            <span className="k">{t('points')}</span>
            <span className="v">
              <Tag color={profile.violationPoints >= 10 ? 'red' : profile.violationPoints >= 6 ? 'orange' : 'default'}>
                {profile.violationPoints}
              </Tag>
            </span>
          </div>
        </div>
        {profile.violations.map((v: any) => (
          <div className="self-row" key={v.id}>
            <div className="self-row-top">
              <div className="self-row-title">{dict(v.type)}</div>
              <Tag color={v.severity === 'CRITICAL' ? 'red' : v.severity === 'HIGH' ? 'orange' : 'default'}>
                -{v.points}
              </Tag>
            </div>
            <div className="self-row-meta">
              {new Date(v.occurredAt).toLocaleDateString()}
              {v.fine > 0 && ` · Rp ${v.fine.toLocaleString()}`}
            </div>
          </div>
        ))}
      </>
    );

  return (
    <div>
      <Tabs
        size="small"
        items={[
          { key: 'noti', label: <Badge count={profile.counts.unreadNotifications} size="small" offset={[8, -2]}>{t('notifications')}</Badge>, children: notiPane },
          { key: 'ann', label: t('announcements'), children: annPane },
          { key: 'items', label: t('myItems'), children: itemsPane },
          { key: 'vio', label: t('myViolations'), children: vioPane },
        ]}
      />
      <Popconfirm title={t('logout')} onConfirm={logout}>
        <Button block danger icon={<LogoutOutlined />} style={{ marginTop: 16 }}>{t('logout')}</Button>
      </Popconfirm>
      <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} align="center">
        <span style={{ fontSize: 11, color: '#bfbfbf' }}>
          {profile.person.name} · {profile.person.employeeNo}
        </span>
      </Space>
    </div>
  );
}
