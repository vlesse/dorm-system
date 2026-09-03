import { useEffect, useState } from 'react';
import { Layout, Menu, Select, Badge, Spin, Typography } from 'antd';
import {
  DashboardOutlined, ApartmentOutlined, TeamOutlined, HeartOutlined,
  FileTextOutlined, WarningOutlined, SettingOutlined, ToolOutlined,
  SafetyCertificateOutlined, UserSwitchOutlined, AuditOutlined, FireOutlined,
} from '@ant-design/icons';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { api } from './api';
import { useT, useLang, LANGS } from './i18n';
import { MetaContext } from './meta';
import Dashboard from './pages/Dashboard';
import BedMap from './pages/BedMap';
import Persons from './pages/Persons';
import Families from './pages/Families';
import Requests from './pages/Requests';
import WorkOrders from './pages/WorkOrders';
import Violations from './pages/Violations';
import Visitors from './pages/Visitors';
import Inspections from './pages/Inspections';
import Roster from './pages/Roster';
import Evacuation from './pages/Evacuation';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';

const { Header, Sider, Content } = Layout;

export default function App() {
  const t = useT();
  const { lang, setLang } = useLang();
  const nav = useNavigate();
  const loc = useLocation();
  const [meta, setMeta] = useState<any>(null);
  const [counts, setCounts] = useState<any>({ alerts: 0, requests: 0, workOrders: 0 });

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
    api.dashboard().then((d) => {
      const alerts = Object.values(d.alertCounts as Record<string, number>).reduce((a, b) => a + b, 0);
      setCounts({ alerts, requests: d.operations.requestsPending, workOrders: d.operations.workOrdersOpen });
    }).catch(() => {});
  }, []);

  const withBadge = (label: string, n: number) => (
    <span>{label}{n > 0 && <Badge count={n} size="small" offset={[6, -2]} overflowCount={999} />}</span>
  );

  const items = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: t('nav_dashboard') },
    {
      type: 'group' as const, label: t('grp_space'), children: [
        { key: '/beds', icon: <ApartmentOutlined />, label: t('nav_bedmap') },
        { key: '/persons', icon: <TeamOutlined />, label: t('nav_persons') },
        { key: '/families', icon: <HeartOutlined />, label: t('nav_families') },
      ],
    },
    {
      type: 'group' as const, label: t('grp_ops'), children: [
        { key: '/requests', icon: <AuditOutlined />, label: withBadge(t('nav_requests'), counts.requests) },
        { key: '/workorders', icon: <ToolOutlined />, label: withBadge(t('nav_workorders'), counts.workOrders) },
        { key: '/violations', icon: <SafetyCertificateOutlined />, label: t('nav_violations') },
        { key: '/visitors', icon: <UserSwitchOutlined />, label: t('nav_visitors') },
        { key: '/inspections', icon: <FileTextOutlined />, label: t('nav_inspections') },
      ],
    },
    {
      type: 'group' as const, label: t('grp_report'), children: [
        { key: '/roster', icon: <FileTextOutlined />, label: t('nav_roster') },
        { key: '/evacuation', icon: <FireOutlined />, label: t('nav_evacuation') },
        { key: '/alerts', icon: <WarningOutlined />, label: withBadge(t('nav_alerts'), counts.alerts) },
      ],
    },
    {
      type: 'group' as const, label: t('grp_system'), children: [
        { key: '/settings', icon: <SettingOutlined />, label: t('nav_settings') },
      ],
    },
  ];

  const allKeys = ['/dashboard', '/beds', '/persons', '/families', '/requests', '/workorders',
    '/violations', '/visitors', '/inspections', '/roster', '/evacuation', '/alerts', '/settings'];

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
            <Typography.Text style={{ color: '#fff', fontSize: 17, fontWeight: 600 }}>{t('appName')}</Typography.Text>
            <Typography.Text style={{ color: 'rgba(255,255,255,.55)', fontSize: 12 }}>{meta.site?.name}</Typography.Text>
          </div>
          <Select size="small" value={lang} onChange={setLang} options={LANGS} style={{ width: 110 }} />
        </Header>
        <Layout>
          <Sider width={196} theme="light" breakpoint="lg" collapsedWidth={0} zeroWidthTriggerStyle={{ top: 8 }}
            style={{ overflow: 'auto' }}>
            <Menu
              mode="inline"
              selectedKeys={[allKeys.find((k) => loc.pathname.startsWith(k)) ?? '/dashboard']}
              items={items}
              onClick={(e) => nav(e.key)}
              style={{ borderRight: 0, paddingBottom: 24 }}
            />
          </Sider>
          <Content style={{ padding: 16, overflow: 'auto' }}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/beds" element={<BedMap />} />
              <Route path="/persons" element={<Persons />} />
              <Route path="/families" element={<Families />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/workorders" element={<WorkOrders />} />
              <Route path="/violations" element={<Violations />} />
              <Route path="/visitors" element={<Visitors />} />
              <Route path="/inspections" element={<Inspections />} />
              <Route path="/roster" element={<Roster />} />
              <Route path="/evacuation" element={<Evacuation />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </MetaContext.Provider>
  );
}
