/**
 * 员工自助端的 API 客户端。
 * 有意用独立的 token key —— 宿管和员工可以在同一台设备上分别登录，互不冲突。
 */
const BASE = '/api/self';
const TOKEN_KEY = 'dorm.selfToken';

export const getSelfToken = () => localStorage.getItem(TOKEN_KEY);
export const setSelfToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

let onUnauthenticated: (() => void) | null = null;
export const setSelfUnauthenticatedHandler = (fn: () => void) => { onUnauthenticated = fn; };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getSelfToken();
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    setSelfToken(null);
    onUnauthenticated?.();
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(body?.error ?? res.statusText) as Error & { status: number; body: any };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

const post = (p: string, b: any) => req<any>(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p: string, b: any = {}) => req<any>(p, { method: 'PUT', body: JSON.stringify(b) });

export const selfApi = {
  requestOtp: (employeeNo: string) => post('/otp/request', { employeeNo }),
  verifyOtp: (employeeNo: string, code: string) => post('/otp/verify', { employeeNo, code }),

  profile: () => req<any>('/profile'),
  meta: () => req<any>('/meta'),

  workOrders: () => req<any[]>('/workorders'),
  createWorkOrder: (b: { categoryId: number; title: string; description?: string }) => post('/workorders', b),
  rateWorkOrder: (id: number, rating: number) => put(`/workorders/${id}/rate`, { rating }),

  requests: () => req<any[]>('/requests'),
  createRequest: (b: { type: string; reason: string }) => post('/requests', b),
  cancelRequest: (id: number) => put(`/requests/${id}/cancel`),

  notifications: () => req<any[]>('/notifications'),
  readNotification: (id: number) => put(`/notifications/${id}/read`),
  announcements: () => req<any[]>('/announcements'),

  room: (code: string) => req<any>(`/room/${encodeURIComponent(code)}`),
};
