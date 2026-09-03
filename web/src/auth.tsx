import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken, setUnauthenticatedHandler } from './api';

export interface CurrentUser {
  id: number;
  username: string;
  name: string;
  role: string;
  roleName?: string;
  perms: string[];
  locale: string;
  mustChangePassword: boolean;
  buildings: { id: number; code: string; name: string }[];
  scopeAll: boolean;
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (perm: string) => boolean;
}

const AuthContext = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(AuthContext);

/** 权限判断与后端 hasPermission 保持同一套规则 */
export function can(perms: string[] | undefined, needed: string): boolean {
  if (!perms) return false;
  if (perms.includes('*')) return true;
  if (perms.includes(needed)) return true;
  const [mod] = needed.split(':');
  return perms.includes(`${mod}:*`);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    setUnauthenticatedHandler(() => setUser(null));
    refresh().finally(() => setLoading(false));
  }, []);

  const value: AuthState = {
    user,
    loading,
    login: async (username, password) => {
      const r = await api.login(username, password);
      setToken(r.token);
      await refresh();
    },
    logout: async () => {
      try { await api.logout(); } catch { /* token 可能已过期，忽略 */ }
      setToken(null);
      setUser(null);
    },
    refresh,
    can: (perm) => can(user?.perms, perm),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
