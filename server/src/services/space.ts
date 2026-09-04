import { prisma } from '../db.js';
import type { PersonLike, TargetContext, OccupantLike } from './rules.js';

/** 空间策略逐级继承：房间 > 楼层 > 楼栋 */
export function resolveGender(room: any): string | null {
  const v = room.genderPolicy ?? room.floor.genderPolicy ?? room.floor.building.genderPolicy;
  return v === 'MIXED' ? null : v;
}
export function resolveNationality(room: any): string | null {
  return room.nationalityId ?? room.floor.nationalityId ?? room.floor.building.nationalityId ?? null;
}

export const PERSON_INCLUDE = {
  nationality: true,
  department: true,
  positionLevel: true,
  shift: true,
  contractor: true,
  religion: true,
} as const;

export const ROOM_INCLUDE = {
  roomType: true,
  floor: { include: { building: true } },
  assets: true,
  beds: {
    orderBy: { id: 'asc' as const },
    include: {
      occupancies: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'HELD'] } },
        include: { person: { include: PERSON_INCLUDE } },
      },
    },
  },
};

/** 一次性取出某人已核验的配偶 id（夫妻房规则要用） */
export async function spouseIdsOf(personId: number): Promise<number[]> {
  const rows = await prisma.relationship.findMany({
    where: {
      type: 'SPOUSE',
      verified: true,
      OR: [{ personId }, { relatedPersonId: personId }],
    },
  });
  return rows.map((r) => (r.personId === personId ? r.relatedPersonId : r.personId));
}

/** 批量版本：排宿批处理时避免 N+1 */
export async function spouseMap(personIds: number[]): Promise<Map<number, number[]>> {
  const rows = await prisma.relationship.findMany({
    where: { type: 'SPOUSE', verified: true },
  });
  const m = new Map<number, number[]>();
  const push = (a: number, b: number) => {
    if (!m.has(a)) m.set(a, []);
    m.get(a)!.push(b);
  };
  for (const r of rows) {
    push(r.personId, r.relatedPersonId);
    push(r.relatedPersonId, r.personId);
  }
  return m;
}

export const parseLangs = (s: string | null | undefined) =>
  (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function personToLike(p: any, spouseIds: number[] = []): PersonLike {
  return {
    id: p.id,
    name: p.name,
    personType: p.personType,
    gender: p.gender,
    nationalityId: p.nationalityId,
    departmentId: p.departmentId,
    positionLevelId: p.positionLevelId,
    shiftId: p.shiftId,
    contractorId: p.contractorId,
    religionId: p.religionId,
    hasDietaryRule: p.religion?.hasDietaryRule ?? false,
    isSmoker: p.isSmoker,
    needsLowerBunk: p.needsLowerBunk,
    needsGroundFloor: p.needsGroundFloor,
    languages: parseLangs(p.languages),
    positionRank: p.positionLevel?.rank ?? 0,
    contractorIsSelf: p.contractor?.isSelf ?? true,
    spouseIds,
    hostPersonId: p.hostPersonId ?? null,
    coupleRoomAllowed: p.positionLevel?.coupleRoomAllowed ?? false,
  };
}

function occupantToLike(o: any): OccupantLike {
  return {
    personId: o.id,
    gender: o.gender,
    nationalityId: o.nationalityId,
    departmentId: o.departmentId,
    shiftId: o.shiftId,
    contractorIsSelf: o.contractor?.isSelf ?? true,
    hasDietaryRule: o.religion?.hasDietaryRule ?? false,
    isSmoker: o.isSmoker,
    languages: parseLangs(o.languages),
    hostPersonId: o.hostPersonId ?? null,
  };
}

export function roomToContext(room: any, bed?: any): TargetContext {
  const occupants = room.beds.flatMap((b: any) => b.occupancies.map((o: any) => o.person));
  return {
    roomStatus: room.status,
    roomCapacity: room.capacity,
    currentOccupantCount: occupants.length,
    genderPolicy: resolveGender(room),
    nationalityId: resolveNationality(room),
    minPositionRank: room.roomType.minPositionRank,
    roomTypeName: room.roomType.nameZh,
    isResidential: room.roomType.isResidential,
    isCoupleRoom: room.roomType.isCoupleRoom,
    allowMixedGender: room.roomType.allowMixedGender,
    allowDependents: room.roomType.allowDependents,
    bedPosition: bed?.position,
    bedStatus: bed?.status,
    floorLevel: room.floor.level,
    buildingHasElevator: room.floor.building.hasElevator,
    occupants: occupants.map(occupantToLike),
  };
}

/** 房间序列化 —— 前端床位图直接消费 */
export function serializeRoom(room: any) {
  const usableBeds = room.beds.filter((b: any) => !['DISABLED'].includes(b.status));
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    status: room.status,
    /** 核定人数 */
    capacity: room.capacity,
    /** 房型标称规格 */
    nominalCapacity: room.roomType.defaultCapacity,
    deratedReason: room.deratedReason,
    isDerated: room.capacity < room.roomType.defaultCapacity,
    bedCount: room.beds.length,
    usableBedCount: usableBeds.length,
    hasAC: room.hasAC,
    hasBathroom: room.hasBathroom,
    hasWaterHeater: room.hasWaterHeater,
    hasBalcony: room.hasBalcony,
    orientation: room.orientation,
    area: room.area,
    note: room.note,
    roomType: {
      id: room.roomType.id, code: room.roomType.code,
      nameZh: room.roomType.nameZh, nameEn: room.roomType.nameEn, nameId: room.roomType.nameId,
      managementMode: room.roomType.managementMode, color: room.roomType.color,
      dailyRate: room.roomType.dailyRate, minPositionRank: room.roomType.minPositionRank,
      isResidential: room.roomType.isResidential,
      isCoupleRoom: room.roomType.isCoupleRoom,
      allowMixedGender: room.roomType.allowMixedGender,
      allowDependents: room.roomType.allowDependents,
    },
    effectiveGender: resolveGender(room),
    effectiveNationality: resolveNationality(room),
    assets: (room.assets ?? []).map((a: any) => ({
      id: a.id, category: a.category, name: a.name, status: a.status, assetNo: a.assetNo,
    })),
    floor: room.floor
      ? {
          id: room.floor.id, level: room.floor.level, name: room.floor.name,
          buildingId: room.floor.buildingId, buildingCode: room.floor.building?.code,
          buildingName: room.floor.building?.name,
          hasElevator: room.floor.building?.hasElevator,
        }
      : undefined,
    beds: room.beds.map((b: any) => {
      const occ = b.occupancies[0];
      return {
        id: b.id, code: b.code, label: b.label, position: b.position,
        status: b.status, isExtra: b.isExtra, note: b.note,
        occupancy: occ
          ? {
              id: occ.id, status: occ.status, checkInAt: occ.checkInAt, note: occ.note,
              person: serializeOccupant(occ.person),
            }
          : null,
      };
    }),
  };
}

export function serializeOccupant(p: any) {
  return {
    id: p.id, employeeNo: p.employeeNo, name: p.name, personType: p.personType,
    gender: p.gender, nationalityId: p.nationalityId,
    nationalityColor: p.nationality?.color ?? '#999',
    department: p.department?.nameZh ?? null, departmentId: p.departmentId,
    positionLevel: p.positionLevel?.nameZh ?? null,
    positionRank: p.positionLevel?.rank ?? 0,
    shift: p.shift?.nameZh ?? null, shiftId: p.shiftId, shiftColor: p.shift?.color ?? null,
    contractor: p.contractor?.name ?? null, contractorIsSelf: p.contractor?.isSelf ?? true,
    religion: p.religion?.nameZh ?? null, hasDietaryRule: p.religion?.hasDietaryRule ?? false,
    isSmoker: p.isSmoker, needsLowerBunk: p.needsLowerBunk, needsGroundFloor: p.needsGroundFloor,
    employmentStatus: p.employmentStatus, hostPersonId: p.hostPersonId,
    idExpiryDate: p.idExpiryDate,
  };
}

export async function loadRoom(roomId: number) {
  return prisma.room.findUnique({ where: { id: roomId }, include: ROOM_INCLUDE });
}

/** 生成业务单号：WO20260902-0001 这种 */
export async function nextCode(prefix: string, model: 'workOrder' | 'violation' | 'visitor' | 'inspection' | 'request') {
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const head = `${prefix}${day}`;
  const count = await (prisma as any)[model].count({ where: { code: { startsWith: head } } });
  return `${head}-${String(count + 1).padStart(4, '0')}`;
}

/**
 * 按房型「标称规格」摆床。
 * seed 生成和批量导入共用这一份，免得两边规格漂移。
 * 超出核定人数的床由调用方标记为 DISABLED（降标撤除）。
 */
export function bedLayoutFor(nominal: number, typeCode: string): Array<{ label: string; position: string }> {
  if (typeCode === 'COUPLE') {
    return [
      { label: '双人床 · 铺位1', position: 'DOUBLE' },
      { label: '双人床 · 铺位2', position: 'DOUBLE' },
    ];
  }
  if (typeCode === 'FAMILY') {
    return [
      { label: '双人床 · 铺位1', position: 'DOUBLE' },
      { label: '双人床 · 铺位2', position: 'DOUBLE' },
      { label: '儿童床 1', position: 'SINGLE' },
      { label: '儿童床 2', position: 'SINGLE' },
    ];
  }
  if (nominal <= 3) {
    return Array.from({ length: Math.max(nominal, 1) }, (_, i) => ({ label: `${i + 1} 号床`, position: 'SINGLE' }));
  }
  const out: Array<{ label: string; position: string }> = [];
  for (let i = 1; i <= Math.floor(nominal / 2); i++) {
    out.push({ label: `${i} 下铺`, position: 'LOWER' });
    out.push({ label: `${i} 上铺`, position: 'UPPER' });
  }
  if (nominal % 2 === 1) out.push({ label: `${Math.ceil(nominal / 2)} 号床`, position: 'SINGLE' });
  return out;
}
