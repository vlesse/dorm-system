import { useEffect, useState } from 'react';
import { Layout, Menu, Select, Badge, Spin, Typography } from 'antd';
import {
  DashboardOutlined, ApartmentOutlined, TeamOutlined,
  FileTextOutlined, WarningOutlined, SettingOutlined,
} from '@ant-design/icons';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { api } from './api';
import { useT, useLang, LANGS } from './i18n';
import { MetaContext } from './meta';
import Dashboard from './pages/Dashboard';
import BedMap from './pages/BedMap';
import Persons from './pages/Persons';
import Roster from './pages/Roster';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';

const { Header, Sider, Content } = Layout;

export default function App() {
  const t = useT();
  const { lang, setLang } = useLang();
  const nav = useNavigate();
  const loc = useLocation();
  const [meta, setMeta] = useState<any>(null);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
    api.dashboard()
      .then((d) => setAlertCount(Object.values(d.alertCounts as Record<string, number>).reduce((a, b) => a + b, 0)))
      .catch(() => {});
  }, []);

  const items = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: t('nav_dashboard') },
    { key: '/beds', icon: <ApartmentOutlined />, label: t('nav_bedmap') },
    { key: '/persons', icon: <TeamOutlined />, label: t('nav_persons') },
    { key: '/roster', icon: <FileTextOutlined />, label: t('nav_roster') },
    {
      key: '/alerts',
      icon: <WarningOutlined />,
      label: <span>{t('nav_alerts')} {alertCount > 0 && <Badge count={alertCount} size="small" offset={[4, -2]} />}</span>,
    },
    { key: '/settings', icon: <SettingOutlined />, label: t('nav_settings') },
  ];

  if (!meta) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Spin tip="连接后端 API…" size="large"><div style={{ padding: 40 }} /></Spin>
      </div>
    );
  }

  return (
    <MetaContext.Provider value={meta}>
      <Layout style={{ height: '100%' }}>
        <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', background: '#001529' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <Typography.Text style={{ color: '#fff', fontSize: 17, fontWeight: 600 }}>
              {t('appName')}
            </Typography.Text>
            <Typography.Text style={{ color: 'rgba(255,255,255,.55)', fontSize: 12 }}>
              {meta.site?.name}
            </Typography.Text>
          </div>
          <Select
            size="small" value={lang} onChange={setLang} options={LANGS}
            style={{ width: 110 }}
          />
        </Header>
        <Layout>
          <Sider width={190} theme="light" breakpoint="lg" collapsedWidth={0} zeroWidthTriggerStyle={{ top: 8 }}>
            <Menu
              mode="inline"
              selectedKeys={[items.find((i) => loc.pathname.startsWith(i.key))?.key ?? '/dashboard']}
              items={items}
              onClick={(e) => nav(e.key)}
              style={{ height: '100%', borderRight: 0 }}
            />
          </Sider>
          <Content style={{ padding: 16, overflow: 'auto' }}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/beds" element={<BedMap />} />
              <Route path="/persons" element={<Persons />} />
              <Route path="/roster" element={<Roster />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </MetaContext.Provider>
  );
}
