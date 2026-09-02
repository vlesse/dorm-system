const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
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

export const api = {
  meta: () => req<any>('/meta'),
  dashboard: () => req<any>('/dashboard'),
  alerts: () => req<any>('/alerts'),

  tree: () => req<any[]>('/space/tree'),
  floor: (id: number) => req<any>(`/space/floors/${id}`),
  room: (id: number) => req<any>(`/space/rooms/${id}`),
  updateFloor: (id: number, body: any) => req<any>(`/space/floors/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  updateBuilding: (id: number, body: any) => req<any>(`/space/buildings/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  updateRoom: (id: number, body: any) => req<any>(`/space/rooms/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  persons: (q: Record<string, any>) => req<any>(`/persons${qs(q)}`),
  person: (id: number) => req<any>(`/persons/${id}`),
  updatePerson: (id: number, body: any) => req<any>(`/persons/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  bedHistory: (id: number) => req<any[]>(`/beds/${id}/history`),

  candidates: (personId: number, q: Record<string, any> = {}) => req<any>(`/allocation/candidates/${personId}${qs(q)}`),
  assign: (body: any) => req<any>('/allocation/assign', { method: 'POST', body: JSON.stringify(body) }),
  transfer: (body: any) => req<any>('/allocation/transfer', { method: 'POST', body: JSON.stringify(body) }),
  checkout: (body: any) => req<any>('/allocation/checkout', { method: 'POST', body: JSON.stringify(body) }),
  hold: (body: any) => req<any>('/allocation/hold', { method: 'POST', body: JSON.stringify(body) }),
  resume: (body: any) => req<any>('/allocation/resume', { method: 'POST', body: JSON.stringify(body) }),

  roster: (q: Record<string, any>) => req<any[]>(`/roster${qs(q)}`),
  rosterCsvUrl: (q: Record<string, any>) => `${BASE}/roster.csv${qs(q)}`,

  devices: (q: Record<string, any>) => req<any[]>(`/devices${qs(q)}`),
  settings: () => req<any[]>('/config/settings'),
  saveSetting: (key: string, value: any) => req<any>(`/config/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  dict: (name: string) => req<any[]>(`/config/${name}`),
  updateDict: (name: string, id: string | number, body: any) =>
    req<any>(`/config/${name}/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  createDict: (name: string, body: any) => req<any>(`/config/${name}`, { method: 'POST', body: JSON.stringify(body) }),
};
