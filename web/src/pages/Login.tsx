import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Typography, Space, Alert, Divider, Select, App, Tag } from 'antd';
import { UserOutlined, LockOutlined, QrcodeOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useAuth } from '../auth';
import { useT, useLang, LANGS } from '../i18n';

/**
 * 登录页。
 * 管理端走账号密码；企业平台扫码在凭据配置好之后自动出现在下面。
 * 员工本人不发账号密码 —— 见页脚说明。
 */
export default function Login() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { login } = useAuth();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [methods, setMethods] = useState<any>({ local: true, sso: [] });

  useEffect(() => { api.authMethods().then(setMethods).catch(() => {}); }, []);

  const onFinish = async (v: { username: string; password: string }) => {
    setLoading(true); setError(null);
    try {
      await login(v.username, v.password);
      message.success('登录成功');
    } catch (e: any) {
      setError(e.message ?? '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const ssoClick = async (provider: string, nameZh: string, enabled: boolean) => {
    if (!enabled) {
      message.warning(`${nameZh} 尚未启用 —— 需要先在「设置 → 集成对接」填入企业凭据`);
      return;
    }
    try {
      await api.me(); // 占位：真实实现会跳转到平台授权页
    } catch { /* ignore */ }
    message.info(`${nameZh} 扫码登录待接入`);
  };

  return (
    <div style={{
      height: '100%', display: 'grid', placeItems: 'center',
      background: 'linear-gradient(135deg, #001529 0%, #003a70 100%)',
    }}>
      <div style={{ width: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Typography.Title level={3} style={{ color: '#fff', marginBottom: 4 }}>
            {t('appName')}
          </Typography.Title>
          <Typography.Text style={{ color: 'rgba(255,255,255,.65)' }}>
            青山工业园区（IMIP）· Sistem Manajemen Asrama
          </Typography.Text>
        </div>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <Select size="small" value={lang} onChange={setLang} options={LANGS} style={{ width: 110 }} />
          </div>

          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}

          <Form layout="vertical" onFinish={onFinish} initialValues={{ username: 'admin' }}>
            <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
              <Input prefix={<UserOutlined />} placeholder="username" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="password" autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
          </Form>

          {methods.sso?.length > 0 && (
            <>
              <Divider plain style={{ fontSize: 12, color: '#8c8c8c' }}>企业平台登录</Divider>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {methods.sso.map((s: any) => (
                  <Button key={s.provider} block icon={<QrcodeOutlined />}
                    onClick={() => ssoClick(s.provider, s.nameZh, s.enabled)}
                    style={{ opacity: s.enabled ? 1 : 0.65 }}>
                    {lang === 'zh' ? s.nameZh : lang === 'id' ? s.nameId : s.nameEn}
                    {!s.enabled && <Tag style={{ marginLeft: 8 }}>未配置</Tag>}
                  </Button>
                ))}
              </Space>
            </>
          )}

          <Alert
            type="info" style={{ marginTop: 16 }}
            message={<span style={{ fontSize: 12 }}>演示账号</span>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.9 }}>
                <code>admin</code> 系统管理员（密码单独设置，见部署说明）<br />
                <code>dorm.chief</code> 宿舍主管（看全部楼栋）<br />
                <code>warden.a</code> A 栋宿管（<b>只看得到 A 栋</b>）<br />
                <code>hr01</code> 人力资源 · <code>ehs01</code> 安全环保<br />
                除 admin 外初始密码 <code>dorm@2026</code>，首次登录强制改密
              </div>
            }
          />
        </Card>

        <Typography.Paragraph style={{ color: 'rgba(255,255,255,.5)', fontSize: 12, marginTop: 16, textAlign: 'center' }}>
          员工本人不单独发账号密码 —— 走企业微信 / 钉钉扫码，或工号 + 手机验证码。
        </Typography.Paragraph>
      </div>
    </div>
  );
}
