import { prisma } from '../db.js';
import type { PersonLike, TargetContext } from './rules.js';

/** 空间策略逐级继承：房间 > 楼层 > 楼栋 */
export function resolveGender(room: any): string | null {
  const v = room.genderPolicy ?? room.floor.genderPolicy ?? room.floor.building.genderPolicy;
  return v === 'MIXED' ? null : v;
}
export function resolveNationality(room: any): string | null {
  return room.nationalityId ?? room.floor.nationalityId ?? room.floor.building.nationalityId ?? null;
}

export const ROOM_INCLUDE = {
  roomType: true,
  floor: { include: { building: true } },
  beds: {
    orderBy: { id: 'asc' as const },
    include: {
      occupancies: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'HELD'] } },
        include: {
          person: {
            include: { nationality: true, department: true, positionLevel: true, shift: true, contractor: true },
          },
        },
      },
    },
  },
};

export function personToLike(p: any): PersonLike {
  return {
    id: p.id, name: p.name, gender: p.gender, nationalityId: p.nationalityId,
    departmentId: p.departmentId, positionLevelId: p.positionLevelId,
    shiftId: p.shiftId, contractorId: p.contractorId,
    positionRank: p.positionLevel.rank, contractorIsSelf: p.contractor.isSelf,
  };
}

export function roomToContext(room: any): TargetContext {
  const occupants = room.beds.flatMap((b: any) => b.occupancies.map((o: any) => o.person));
  return {
    roomStatus: room.status,
    roomCapacity: room.capacity,
    currentOccupantCount: occupants.length,
    genderPolicy: resolveGender(room),
    nationalityId: resolveNationality(room),
    minPositionRank: room.roomType.minPositionRank,
    roomTypeName: room.roomType.nameZh,
    occupants: occupants.map((o: any) => ({
      shiftId: o.shiftId, departmentId: o.departmentId,
      contractorIsSelf: o.contractor.isSelf, gender: o.gender, nationalityId: o.nationalityId,
    })),
  };
}

/** 把房间序列化成前端要的形状 */
export function serializeRoom(room: any) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    status: room.status,
    capacity: room.capacity,
    hasAC: room.hasAC,
    hasBathroom: room.hasBathroom,
    area: room.area,
    note: room.note,
    roomType: {
      id: room.roomType.id, code: room.roomType.code, nameZh: room.roomType.nameZh,
      nameEn: room.roomType.nameEn, nameId: room.roomType.nameId,
      managementMode: room.roomType.managementMode, color: room.roomType.color,
      dailyRate: room.roomType.dailyRate, minPositionRank: room.roomType.minPositionRank,
    },
    effectiveGender: resolveGender(room),
    effectiveNationality: resolveNationality(room),
    floor: room.floor
      ? { id: room.floor.id, level: room.floor.level, name: room.floor.name,
          buildingId: room.floor.buildingId, buildingCode: room.floor.building?.code,
          buildingName: room.floor.building?.name }
      : undefined,
    beds: room.beds.map((b: any) => {
      const occ = b.occupancies[0];
      return {
        id: b.id, code: b.code, label: b.label, position: b.position,
        status: b.status, note: b.note,
        occupancy: occ
          ? {
              id: occ.id, status: occ.status, checkInAt: occ.checkInAt, note: occ.note,
              person: {
                id: occ.person.id, employeeNo: occ.person.employeeNo, name: occ.person.name,
                gender: occ.person.gender, nationalityId: occ.person.nationalityId,
                nationalityColor: occ.person.nationality.color,
                department: occ.person.department.nameZh, departmentId: occ.person.departmentId,
                positionLevel: occ.person.positionLevel.nameZh,
                positionRank: occ.person.positionLevel.rank,
                shift: occ.person.shift?.nameZh ?? null,
                shiftId: occ.person.shiftId,
                shiftColor: occ.person.shift?.color ?? null,
                contractor: occ.person.contractor.name,
                contractorIsSelf: occ.person.contractor.isSelf,
                employmentStatus: occ.person.employmentStatus,
              },
            }
          : null,
      };
    }),
  };
}

export async function loadRoom(roomId: number) {
  return prisma.room.findUnique({ where: { id: roomId }, include: ROOM_INCLUDE });
}
