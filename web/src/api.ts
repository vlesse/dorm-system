const BASE = '/api';

const TOKEN_KEY = 'dorm.token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

/** 401 时通知外层跳登录页 —— 由 auth.tsx 注册 */
let onUnauthenticated: (() => void) | null = null;
export const setUnauthenticatedHandler = (fn: () => void) => { onUnauthenticated = fn; };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    setToken(null);
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

const qs = (o: Record<string, any>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const post = (p: string, body: any) => req<any>(p, { method: 'POST', body: JSON.stringify(body) });
const put = (p: string, body: any) => req<any>(p, { method: 'PUT', body: JSON.stringify(body) });

export const api = {
  meta: () => req<any>('/meta'),
  dashboard: () => req<any>('/dashboard'),
  alerts: () => req<any>('/alerts'),

  // 空间
  tree: () => req<any[]>('/space/tree'),
  floor: (id: number) => req<any>(`/space/floors/${id}`),
  floorSummary: (id: number) => req<any[]>(`/space/floors/${id}/summary`),
  room: (id: number) => req<any>(`/space/rooms/${id}`),
  updateFloor: (id: number, b: any) => put(`/space/floors/${id}`, b),
  updateBuilding: (id: number, b: any) => put(`/space/buildings/${id}`, b),
  updateRoom: (id: number, b: any) => put(`/space/rooms/${id}`, b),
  setRoomCapacity: (id: number, b: { capacity: number; deratedReason?: string | null }) =>
    put(`/space/rooms/${id}/capacity`, b),
  setBedStatus: (id: number, b: { status: string; note?: string }) => put(`/beds/${id}/status`, b),
  roomQrCode: (id: number) => req<any>(`/space/rooms/${id}/qrcode`),
  floorQrCodes: (id: number) => req<any[]>(`/space/floors/${id}/qrcodes`),

  // 人员
  persons: (q: Record<string, any>) => req<any>(`/persons${qs(q)}`),
  person: (id: number) => req<any>(`/persons/${id}`),
  updatePerson: (id: number, b: any) => put(`/persons/${id}`, b),
  createPerson: (b: any) => post('/persons', b),
  bedHistory: (id: number) => req<any[]>(`/beds/${id}/history`),
  contacts: (id: number, q: Record<string, any> = {}) => req<any>(`/persons/${id}/contacts${qs(q)}`),

  // 亲属关系
  relationships: (q: Record<string, any> = {}) => req<any[]>(`/relationships${qs(q)}`),
  createRelationship: (b: any) => post('/relationships', b),
  updateRelationship: (id: number, b: any) => put(`/relationships/${id}`, b),
  deleteRelationship: (id: number) => req<any>(`/relationships/${id}`, { method: 'DELETE' }),

  // 排宿
  candidates: (personId: number, q: Record<string, any> = {}) => req<any>(`/allocation/candidates/${personId}${qs(q)}`),
  assign: (b: any) => post('/allocation/assign', b),
  transfer: (b: any) => post('/allocation/transfer', b),
  checkout: (b: any) => post('/allocation/checkout', b),
  hold: (b: any) => post('/allocation/hold', b),
  resume: (b: any) => post('/allocation/resume', b),
  assignCouple: (b: any) => post('/allocation/assign-couple', b),
  extraBed: (b: any) => post('/allocation/extra-bed', b),

  // 报表
  roster: (q: Record<string, any>) => req<any[]>(`/roster${qs(q)}`),
  rosterCsvUrl: (q: Record<string, any>) => `${BASE}/roster.csv${qs(q)}`,
  evacuation: (q: Record<string, any> = {}) => req<any[]>(`/evacuation${qs(q)}`),

  // 运营
  workOrders: (q: Record<string, any> = {}) => req<any>(`/workorders${qs(q)}`),
  createWorkOrder: (b: any) => post('/workorders', b),
  updateWorkOrder: (id: number, b: any) => put(`/workorders/${id}`, b),
  violations: (q: Record<string, any> = {}) => req<any>(`/violations${qs(q)}`),
  createViolation: (b: any) => post('/violations', b),
  updateViolation: (id: number, b: any) => put(`/violations/${id}`, b),
  violationRanking: () => req<any[]>('/violations/ranking'),

  // 投诉
  complaints: (q: Record<string, any> = {}) => req<any>(`/complaints${qs(q)}`),
  complaint: (id: number) => req<any>(`/complaints/${id}`),
  complaintStats: () => req<any>('/complaints/stats'),
  complaintHotRooms: () => req<any[]>('/complaints/hot-rooms'),
  createComplaint: (b: any) => post('/complaints', b),
  acceptComplaint: (id: number, note?: string) => put(`/complaints/${id}/accept`, { note }),
  investigateComplaint: (id: number, note?: string) => put(`/complaints/${id}/investigate`, { note }),
  resolveComplaint: (id: number, b: any) => put(`/complaints/${id}/resolve`, b),
  closeComplaint: (id: number, note?: string) => put(`/complaints/${id}/close`, { note }),
  commentComplaint: (id: number, note: string, visibleToComplainant: boolean) =>
    post(`/complaints/${id}/comment`, { note, visibleToComplainant }),
  mergeComplaint: (id: number, intoId: number) => put(`/complaints/${id}/merge`, { intoId }),
  /** 揭示匿名投诉人身份。每次调用服务端都会写审计日志 */
  complaintIdentity: (id: number) => req<any>(`/complaints/${id}/identity`),
  visitors: (q: Record<string, any> = {}) => req<any[]>(`/visitors${qs(q)}`),
  createVisitor: (b: any) => post('/visitors', b),
  updateVisitor: (id: number, b: any) => put(`/visitors/${id}`, b),
  inspections: (q: Record<string, any> = {}) => req<any[]>(`/inspections${qs(q)}`),
  inspection: (id: number) => req<any>(`/inspections/${id}`),
  createInspection: (b: any) => post('/inspections', b),
  updateInspection: (id: number, b: any) => put(`/inspections/${id}`, b),
  updateInspectionItem: (id: number, b: any) => put(`/inspection-items/${id}`, b),
  requests: (q: Record<string, any> = {}) => req<any[]>(`/requests${qs(q)}`),
  createRequest: (b: any) => post('/requests', b),
  updateRequest: (id: number, b: any) => put(`/requests/${id}`, b),
  announcements: (q: Record<string, any> = {}) => req<any[]>(`/announcements${qs(q)}`),
  createAnnouncement: (b: any) => post('/announcements', b),
  issuedItems: (q: Record<string, any> = {}) => req<any[]>(`/issued-items${qs(q)}`),
  issueItem: (b: any) => post('/issued-items', b),
  returnItem: (id: number, b: any) => put(`/issued-items/${id}/return`, b),
  deposits: (q: Record<string, any> = {}) => req<any[]>(`/deposits${qs(q)}`),

  // 配置
  devices: (q: Record<string, any>) => req<any[]>(`/devices${qs(q)}`),
  assets: (q: Record<string, any> = {}) => req<any[]>(`/assets${qs(q)}`),
  settings: () => req<any[]>('/config/settings'),
  saveSetting: (key: string, value: any) => put(`/config/settings/${key}`, { value }),
  dict: (name: string) => req<any[]>(`/config/${name}`),

  // 认证
  authMethods: () => req<any>('/auth/methods'),
  login: (username: string, password: string) => post('/auth/login', { username, password }),
  me: () => req<any>('/auth/me'),
  logout: () => post('/auth/logout', {}),
  changePassword: (oldPassword: string, newPassword: string) =>
    post('/auth/change-password', { oldPassword, newPassword }),
  users: () => req<any[]>('/users'),
  createUser: (b: any) => post('/users', b),
  updateUser: (id: number, b: any) => put(`/users/${id}`, b),
  auditLogs: (q: Record<string, any> = {}) => req<any>(`/audit-logs${qs(q)}`),

  // 集成与通知
  integrations: () => req<any[]>('/integrations'),
  updateIntegration: (id: number, b: any) => put(`/integrations/${id}`, b),
  testIntegration: (id: number) => post(`/integrations/${id}/test`, {}),
  notifications: (q: Record<string, any> = {}) => req<any>(`/notifications${qs(q)}`),
  readNotification: (id: number) => put(`/notifications/${id}/read`, {}),
  readAllNotifications: () => put('/notifications/read-all', {}),
  flushNotifications: () => post('/notifications/flush', {}),
  notificationTemplates: () => req<any[]>('/notification-templates'),
  updateNotificationTemplate: (id: number, b: any) => put(`/notification-templates/${id}`, b),
  syncLogs: () => req<any[]>('/sync-logs'),
  syncPersons: (rows: any[], provider = 'EXCEL') => post('/sync/persons', { rows, provider }),

  // 人工批量导入
  importSchema: () => req<any>('/import/schema'),
  importPreview: (type: string, rows: any[]) => post(`/import/${type}/preview`, { rows }),
  importCommit: (type: string, rows: any[], onlyValid = true) =>
    post(`/import/${type}/commit`, { rows, onlyValid }),
  updateDict: (name: string, id: string | number, b: any) => put(`/config/${name}/${id}`, b),
  createDict: (name: string, b: any) => post(`/config/${name}`, b),
};
