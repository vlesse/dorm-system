import { createContext, useContext } from 'react';

export interface Meta {
  site: { id: number; code: string; name: string; address?: string } | null;
  nationalities: any[];
  departments: any[];
  positionLevels: any[];
  shifts: any[];
  contractors: any[];
  roomTypes: any[];
  settings: Record<string, any>;
  defaultRules: Record<string, string>;
  bedStatuses: string[];
  roomStatuses: string[];
  employmentStatuses: string[];
}

export const MetaContext = createContext<Meta>(null as unknown as Meta);
export const useMeta = () => useContext(MetaContext);

export const BED_STATUS_COLOR: Record<string, string> = {
  FREE: '#f5f5f5',
  RESERVED: '#faad14',
  OCCUPIED: '#1677ff',
  HELD: '#722ed1',
  MAINTENANCE: '#ff7875',
  LOCKED: '#8c8c8c',
};

export const BED_STATUS_LABEL: Record<string, [string, string, string]> = {
  FREE: ['空床', 'Kosong', 'Vacant'],
  RESERVED: ['待入住', 'Dipesan', 'Reserved'],
  OCCUPIED: ['在住', 'Dihuni', 'Occupied'],
  HELD: ['休假保留', 'Ditahan', 'Held'],
  MAINTENANCE: ['维修', 'Perbaikan', 'Maintenance'],
  LOCKED: ['封锁', 'Terkunci', 'Locked'],
};

export const ROOM_STATUS_LABEL: Record<string, [string, string, string]> = {
  AVAILABLE: ['可用', 'Tersedia', 'Available'],
  MAINTENANCE: ['维修中', 'Perbaikan', 'Maintenance'],
  QUARANTINE: ['隔离', 'Isolasi', 'Quarantine'],
  LOCKED: ['封锁', 'Terkunci', 'Locked'],
  CLEANING: ['待清洁', 'Dibersihkan', 'Cleaning'],
};

export const EMPLOYMENT_LABEL: Record<string, [string, string, string]> = {
  ACTIVE: ['在职', 'Aktif', 'Active'],
  ON_LEAVE: ['休假中', 'Cuti', 'On Leave'],
  RESIGNED: ['已离职', 'Resign', 'Resigned'],
};

export const OCC_STATUS_LABEL: Record<string, [string, string, string]> = {
  ACTIVE: ['在住', 'Dihuni', 'Active'],
  HELD: ['休假保留', 'Ditahan', 'Held'],
  RESERVED: ['待入住', 'Dipesan', 'Reserved'],
  ENDED: ['已退宿', 'Selesai', 'Ended'],
};

const IDX = { zh: 0, id: 1, en: 2 } as const;
export function labelOf(
  map: Record<string, [string, string, string]>,
  key: string,
  lang: 'zh' | 'id' | 'en'
) {
  return map[key]?.[IDX[lang]] ?? key;
}
