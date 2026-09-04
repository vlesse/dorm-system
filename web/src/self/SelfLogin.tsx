import { useEffect, useState } from 'react';
import { Input, Button, Alert, Space, Select, App, Typography } from 'antd';
import { selfApi, setSelfToken } from './selfApi';
import { useSelfT } from './selfI18n';
import { useLang, LANGS } from '../i18n';
import './self.css';

/**
 * 员工登录：工号 → 验证码。
 * 短信 / WhatsApp 渠道还没启用时，后端会把验证码直接回显并说明原因 ——
 * 这样平台接入之前系统照样能用，而且状态是明说的，不会让人以为是 bug。
 */
export default function SelfLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useSelfT();
  const { lang, setLang } = useLang();
  const { message } = App.useApp();
  const [employeeNo, setEmployeeNo] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<any>(null);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const send = async () => {
    if (!employeeNo.trim()) return message.warning(t('employeeNoHint'));
    setLoading(true);
    try {
      const r = await selfApi.requestOtp(employeeNo.trim());
      setSent(r);
      setCountdown(60);
      if (r.devCode) setCode(r.devCode);
    } catch (e: any) {
      message.error(e.message);
    } finally { setLoading(false); }
  };

  const verify = async () => {
    if (!code.trim()) return;
    setLoading(true);
    try {
      const r = await selfApi.verifyOtp(employeeNo.trim(), code.trim());
      setSelfToken(r.token);
      onLoggedIn();
    } catch (e: any) {
      message.error(e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="self-login">
      <div className="self-login-brand">
        <h1>{t('appName')}</h1>
        <p>青山工业园区（IMIP）· Sistem Manajemen Asrama</p>
      </div>

      <div className="self-login-card">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <Select size="small" value={lang} onChange={setLang} options={LANGS} style={{ width: 110 }} />
        </div>

        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <div style={{ fontSize: 13, color: '#595959', marginBottom: 6 }}>{t('employeeNo')}</div>
            <Input
              size="large" value={employeeNo} placeholder={t('employeeNoHint')}
              onChange={(e) => setEmployeeNo(e.target.value)}
              onPressEnter={send} autoComplete="username" inputMode="text"
            />
          </div>

          {sent && (
            <>
              {sent.devFallback ? (
                <Alert type="warning" showIcon
                  message={`${t('code')}：${sent.devCode}`}
                  description={<span style={{ fontSize: 12 }}>{sent.devHint}</span>} />
              ) : (
                <Alert type="success" showIcon
                  message={`${t('codeSentTo')} ${sent.maskedPhone ?? ''}`} />
              )}
              <div>
                <div style={{ fontSize: 13, color: '#595959', marginBottom: 6 }}>{t('code')}</div>
                <Input
                  size="large" value={code} maxLength={6} placeholder="______"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  onPressEnter={verify} inputMode="numeric"
                  style={{ letterSpacing: 6, fontSize: 20, textAlign: 'center' }}
                />
              </div>
            </>
          )}

          {!sent ? (
            <Button type="primary" size="large" block loading={loading} onClick={send}>
              {t('getCode')}
            </Button>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Button type="primary" size="large" block loading={loading}
                disabled={code.length < 6} onClick={verify}>
                {t('login')}
              </Button>
              <Button type="link" block disabled={countdown > 0} onClick={send}>
                {countdown > 0 ? `${t('resend')} (${countdown}s)` : t('resend')}
              </Button>
            </Space>
          )}

          <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0, textAlign: 'center' }}>
            {t('loginHint')}
          </Typography.Paragraph>
        </Space>
      </div>

      <Typography.Paragraph
        style={{ color: 'rgba(255,255,255,.5)', fontSize: 12, marginTop: 18, textAlign: 'center' }}>
        演示工号：CN00001 / CN00002 / ID00003
      </Typography.Paragraph>
    </div>
  );
}
