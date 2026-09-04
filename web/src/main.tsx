import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import idID from 'antd/locale/id_ID';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth';
import SelfApp from './self/SelfApp';
import { LangContext, type Lang } from './i18n';
import './styles.css';

function Root() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('lang') as Lang) || 'zh');
  useEffect(() => {
    localStorage.setItem('lang', lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang === 'id' ? 'id-ID' : 'en';
  }, [lang]);

  const locale = lang === 'zh' ? zhCN : lang === 'id' ? idID : enUS;
  const ctx = useMemo(() => ({ lang, setLang }), [lang]);

  return (
    <LangContext.Provider value={ctx}>
      <ConfigProvider
        locale={locale}
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: { colorPrimary: '#1677ff', borderRadius: 6, fontSize: 13 },
        }}
      >
        <AntApp>
          <BrowserRouter>
            {/* /m/* = 员工自助端（移动端，独立 token）；其余 = 管理端 */}
            <Routes>
              <Route path="/m/*" element={<SelfApp />} />
              <Route path="/*" element={<AuthProvider><App /></AuthProvider>} />
            </Routes>
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </LangContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
