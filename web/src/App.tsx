import { useEffect, useState } from 'react';
import { Layout, Menu, Select, Badge, Spin, Typography, Dropdown, Space, Avatar, Tag, App as AntApp, Modal, Form, Input } from 'antd';
import {
  DashboardOutlined, ApartmentOutlined, TeamOutlined, HeartOutlined,
  FileTextOutlined, WarningOutlined, SettingOutlined, ToolOutlined,
  SafetyCertificateOutlined, UserSwitchOutlined, AuditOutlined, FireOutlined,
  ApiOutlined, UserOutlined, LogoutOutlined, KeyOutlined,
} from '@ant-design/icons';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { api } from './api';
import { useT, useLang, LANGS } from './i18n';
import { MetaContext } from './meta';
import { useAuth } from './auth';
import NotificationBell from './components/NotificationBell';
import Login from './pages/Login';
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
import Integrations from './pages/Integrations';
import Settings from './pages/Settings';

const { Header, Sider, Content } = Layout;

export default function App() {
  const t = useT();
  const { lang, setLang } = useLang();
  const nav = useNavigate();
  const loc = useLocation();
  const { user, loading, logout, can, refresh } = useAuth();
  const { message } = AntApp.useApp();
  const [meta, setMeta] = useState<any>(null);
  const [counts, setCounts] = useState<any>({ alerts: 0, requests: 0, workOrders: 0 });
  const [pwdOpen, setPwdOpen] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!user) { setMeta(null); return; }
    api.meta().then(setMeta).catch(() => {});
    api.dashboard().then((d) => {
      const alerts = Object.values(d.alertCounts as Record<string, number>).reduce((a: number, b: any) => a + b, 0);
      setCounts({ alerts, requests: d.operations.requestsPending, workOrders: d.operations.workOrdersOpen });
    }).catch(() => {});
  }, [user]);

  // 首次登录强制改密
  useEffect(() => { if (user?.mustChangePassword) setPwdOpen(true); }, [user?.mustChangePassword]);

  if (loading) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}><Spin size="large" /></div>;
  }
  if (!user) return <Login />;

  const withBadge = (label: string, n: number) => (
    <span>{label}{n > 0 && <Badge count={n} size="small" offset={[6, -2]} overflowCount={999} />}</span>
  );

  /** 菜单按权限过滤 —— 没权限的项直接不显示，而不是点进去报 403 */
  const groups = [
    { items: [{ key: '/dashboard', icon: <DashboardOutlined />, label: t('nav_dashboard'), perm: 'report:read' }] },
    {
      label: t('grp_space'), items: [
        { key: '/beds', icon: <ApartmentOutlined />, label: t('nav_bedmap'), perm: 'space:read' },
        { key: '/persons', icon: <TeamOutlined />, label: t('nav_persons'), perm: 'person:read' },
        { key: '/families', icon: <HeartOutlined />, label: t('nav_families'), perm: 'person:read' },
      ],
    },
    {
      label: t('grp_ops'), items: [
        { key: '/requests', icon: <AuditOutlined />, label: withBadge(t('nav_requests'), counts.requests), perm: 'request:read' },
        { key: '/workorders', icon: <ToolOutlined />, label: withBadge(t('nav_workorders'), counts.workOrders), perm: 'workorder:read' },
        { key: '/violations', icon: <SafetyCertificateOutlined />, label: t('nav_violations'), perm: 'violation:read' },
        { key: '/visitors', icon: <UserSwitchOutlined />, label: t('nav_visitors'), perm: 'visitor:read' },
        { key: '/inspections', icon: <FileTextOutlined />, label: t('nav_inspections'), perm: 'inspection:read' },
      ],
    },
    {
      label: t('grp_report'), items: [
        { key: '/roster', icon: <FileTextOutlined />, label: t('nav_roster'), perm: 'report:read' },
        { key: '/evacuation', icon: <FireOutlined />, label: t('nav_evacuation'), perm: 'report:read' },
        { key: '/alerts', icon: <WarningOutlined />, label: withBadge(t('nav_alerts'), counts.alerts), perm: 'report:read' },
      ],
    },
    {
      label: t('grp_system'), items: [
        { key: '/integrations', icon: <ApiOutlined />, label: '集成对接', perm: 'config:read' },
        { key: '/settings', icon: <SettingOutlined />, label: t('nav_settings'), perm: 'config:read' },
      ],
    },
  ];

  const items = groups
    .map((g) => {
      const visible = g.items.filter((i) => can(i.perm));
      if (visible.length === 0) return null;
      const children = visible.map(({ perm, ...rest }) => rest);
      return g.label ? { type: 'group' as const, label: g.label, children } : children[0];
    })
    .filter(Boolean) as any[];

  const allKeys = groups.flatMap((g) => g.items.map((i) => i.key));

  if (!meta) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Spin tip="加载配置…" size="large"><div style={{ padding: 40 }} /></Spin>
      </div>
    );
  }

  return (
    <MetaContext.Provider value={meta}>
      <Layout style={{ height: '100%' }}>
        <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#001529' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <Typography.Text style={{ color: '#fff', fontSize: 17, fontWeight: 600 }}>{t('appName')}</Typography.Text>
            <Typography.Text style={{ color: 'rgba(255,255,255,.55)', fontSize: 12 }}>{meta.site?.name}</Typography.Text>
          </div>
          <Space size={12}>
            <Select size="small" value={lang} onChange={setLang} options={LANGS} style={{ width: 106 }} />
            <NotificationBell />
            <Dropdown
              menu={{
                items: [
                  { key: 'pwd', icon: <KeyOutlined />, label: '修改密码', onClick: () => setPwdOpen(true) },
                  { type: 'divider' },
                  { key: 'out', icon: <LogoutOutlined />, label: '退出登录', danger: true, onClick: () => logout() },
                ],
              }}
            >
              <Space style={{ cursor: 'pointer', color: '#fff' }} size={8}>
                <Avatar size="small" icon={<UserOutlined />} style={{ background: '#1677ff' }} />
                <Space direction="vertical" size={0} style={{ lineHeight: 1.25 }}>
                  <span style={{ fontSize: 13 }}>{user.name}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>
                    {user.roleName}
                    {!user.scopeAll && user.buildings.length > 0 &&
                      ` · 仅 ${user.buildings.map((b) => b.code).join('/')} 栋`}
                  </span>
                </Space>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Layout>
          <Sider width={196} theme="light" breakpoint="lg" collapsedWidth={0}
            zeroWidthTriggerStyle={{ top: 8 }} style={{ overflow: 'auto' }}>
            {!user.scopeAll && user.buildings.length > 0 && (
              <div style={{ padding: '10px 12px 0' }}>
                <Tag color="orange" style={{ fontSize: 11 }}>
                  数据范围：{user.buildings.map((b) => b.code).join('、')} 栋
                </Tag>
              </div>
            )}
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
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>

      <Modal
        open={pwdOpen} title="修改密码"
        closable={!user.mustChangePassword}
        maskClosable={!user.mustChangePassword}
        cancelButtonProps={{ style: user.mustChangePassword ? { display: 'none' } : undefined }}
        onCancel={() => setPwdOpen(false)}
        onOk={async () => {
          const v = await form.validateFields();
          try {
            await api.changePassword(v.oldPassword, v.newPassword);
            message.success('密码已修改');
            setPwdOpen(false);
            form.resetFields();
            await refresh();
          } catch (e: any) { message.error(e.message); }
        }}
      >
        {user.mustChangePassword && (
          <Typography.Paragraph type="warning" style={{ fontSize: 12 }}>
            这是初始密码，首次登录必须修改后才能继续使用。
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical">
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 6, message: '至少 6 位' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </MetaContext.Provider>
  );
}
