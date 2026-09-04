import { useEffect, useState, createContext, useContext } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Spin, Select, Badge } from 'antd';
import {
  HomeOutlined, ToolOutlined, FileTextOutlined, UserOutlined,
} from '@ant-design/icons';
import { selfApi, setSelfToken, setSelfUnauthenticatedHandler } from './selfApi';
import { useSelfT } from './selfI18n';
import { useLang, LANGS } from '../i18n';
import SelfLogin from './SelfLogin';
import SelfHome from './SelfHome';
import SelfRepair from './SelfRepair';
import SelfRequests from './SelfRequests';
import SelfMe from './SelfMe';
import SelfRoom from './SelfRoom';
import './self.css';

interface SelfCtx {
  profile: any;
  reload: () => Promise<void>;
  logout: () => void;
}
const Ctx = createContext<SelfCtx>(null as unknown as SelfCtx);
export const useSelf = () => useContext(Ctx);

/**
 * 员工自助端外壳。移动优先：底部四个大标签，单手能操作。
 * 和管理端完全隔离 —— 独立 token、独立路由、独立样式。
 */
export default function SelfApp() {
  const { t } = useSelfT();
  const { lang, setLang } = useLang();
  const nav = useNavigate();
  const loc = useLocation();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const p = await selfApi.profile();
      setProfile(p);
    } catch {
      setProfile(null);
    }
  };

  useEffect(() => {
    setSelfUnauthenticatedHandler(() => setProfile(null));
    reload().finally(() => setLoading(false));
  }, []);

  const logout = () => { setSelfToken(null); setProfile(null); nav('/m'); };

  if (loading) {
    return <div className="self-center"><Spin size="large" /></div>;
  }
  if (!profile) {
    return <SelfLogin onLoggedIn={async () => { setLoading(true); await reload(); setLoading(false); }} />;
  }

  const tabs = [
    { key: '/m', icon: <HomeOutlined />, label: t('navHome') },
    { key: '/m/repair', icon: <ToolOutlined />, label: t('navRepair'), badge: profile.counts.openWorkOrders },
    { key: '/m/request', icon: <FileTextOutlined />, label: t('navRequest'), badge: profile.counts.pendingRequests },
    { key: '/m/me', icon: <UserOutlined />, label: t('navMe'), badge: profile.counts.unreadNotifications },
  ];
  const active = [...tabs].reverse().find((x) => loc.pathname === x.key || (x.key !== '/m' && loc.pathname.startsWith(x.key)))?.key ?? '/m';

  return (
    <Ctx.Provider value={{ profile, reload, logout }}>
      <div className="self-shell">
        <header className="self-header">
          <div>
            <div className="self-title">{t('appName')}</div>
            <div className="self-sub">{profile.person.name} · {profile.person.employeeNo}</div>
          </div>
          <Select size="small" value={lang} onChange={setLang} options={LANGS}
            style={{ width: 100 }} variant="filled" />
        </header>

        <main className="self-main">
          <Routes>
            <Route index element={<SelfHome />} />
            <Route path="repair" element={<SelfRepair />} />
            <Route path="request" element={<SelfRequests />} />
            <Route path="me" element={<SelfMe />} />
            <Route path="room/:code" element={<SelfRoom />} />
            <Route path="*" element={<Navigate to="/m" replace />} />
          </Routes>
        </main>

        <nav className="self-tabbar">
          {tabs.map((x) => (
            <button key={x.key} className={`self-tab${active === x.key ? ' active' : ''}`}
              onClick={() => nav(x.key)}>
              <Badge count={x.badge ?? 0} size="small" offset={[6, -2]}>
                <span className="self-tab-icon">{x.icon}</span>
              </Badge>
              <span className="self-tab-label">{x.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </Ctx.Provider>
  );
}
