/**
 * 青山园区（IMIP）自己的数据 —— **这是一个客户的样例，不是通用配置**。
 *
 * 包含：行业专属部门、劳务分包商、8 栋楼的真实结构（层数不等、国籍分区到楼层级）。
 *
 * 开通新客户时**不要跑这个文件**。新客户的楼栋结构走
 * 「系统 → 批量导入」的 Excel 模板录入，见 src/routes/imports.ts。
 * 这份留着有两个用处：一是 IMIP 自己重建演示环境，二是给新客户当结构范例。
 */
import type { PrismaClient } from '@prisma/client';
import { bedLayoutFor } from '../src/services/space.js';
import { pick, randInt, chance, weighted, createManyChunked } from './seed-lib.js';
import type { Dict, Space } from './seed-lib.js';


interface BuildingCfg {
  code: string; name: string;
  gender: 'MALE' | 'FEMALE' | 'MIXED';
  nationality: string | null;
  floors: number; roomsPerFloor: number;
  hasElevator?: boolean;
  floorNationality?: Record<number, string | null>;
  mix: Record<string, number>;
  note?: string;
}

export const BUILDINGS: BuildingCfg[] = [
  { code: 'A', name: 'A栋 中方员工宿舍', gender: 'MALE', nationality: 'CN', floors: 8, roomsPerFloor: 14,
    mix: { SIX: 0.6, EIGHT: 0.2, QUAD: 0.2 } },
  { code: 'B', name: 'B栋 中方员工宿舍', gender: 'MALE', nationality: 'CN', floors: 6, roomsPerFloor: 14,
    mix: { SIX: 0.5, QUAD: 0.3, TRIPLE: 0.2 } },
  { code: 'C', name: 'C栋 印尼籍员工宿舍', gender: 'MALE', nationality: 'ID', floors: 6, roomsPerFloor: 16,
    mix: { EIGHT: 0.5, SIX: 0.5 } },
  { code: 'D', name: 'D栋 印尼籍员工宿舍', gender: 'MALE', nationality: 'ID', floors: 4, roomsPerFloor: 16,
    mix: { EIGHT: 0.6, SIX: 0.4 } },
  { code: 'E', name: 'E栋 混合宿舍', gender: 'MALE', nationality: null, floors: 6, roomsPerFloor: 12,
    floorNationality: { 1: 'ID', 2: 'ID', 3: 'CN', 4: 'CN', 5: null, 6: null },
    mix: { SIX: 0.5, QUAD: 0.3, DOUBLE: 0.2 },
    note: '一、二层印尼籍，三、四层中方，五、六层不限国籍（含韩德越等外籍）' },
  { code: 'F', name: 'F栋 女员工宿舍', gender: 'FEMALE', nationality: null, floors: 4, roomsPerFloor: 12,
    floorNationality: { 1: 'ID', 2: 'ID', 3: 'CN', 4: null },
    mix: { QUAD: 0.5, DOUBLE: 0.3, TRIPLE: 0.2 } },
  { code: 'G', name: 'G栋 干部楼 / 专家公寓', gender: 'MIXED', nationality: null, floors: 4, roomsPerFloor: 10,
    hasElevator: true, mix: { CADRE: 0.4, EXPERT: 0.25, DOUBLE: 0.2, SINGLE: 0.15 },
    note: '中层及以上专用，含值班单间' },
  { code: 'H', name: 'H栋 家属楼 / 酒店式公寓', gender: 'MIXED', nationality: null, floors: 8, roomsPerFloor: 12,
    hasElevator: true, mix: { COUPLE: 0.45, FAMILY: 0.12, HOTEL: 0.28, QUARANTINE: 0.08, TRANSIT: 0.07 },
    note: '夫妻房与家属随迁房、酒店式短住、隔离房都在这栋，按需审批入住' },
];

/** 每层固定配的功能房（占楼层空间但不住人） */
const FLOOR_FUNCTION_ROOMS: Array<{ type: string; onFloor?: 'FIRST' | 'ALL'; onlyNationality?: string }> = [
  { type: 'LAUNDRY', onFloor: 'ALL' },
  { type: 'DORM_OFFICE', onFloor: 'FIRST' },
  { type: 'PRAYER', onFloor: 'FIRST' },
  { type: 'ACTIVITY', onFloor: 'FIRST' },
];

/** 摆床规格与批量导入共用同一份实现，见 services/space.ts */

/** 摆床规格与批量导入共用同一份实现，见 services/space.ts */
const bedLayout = bedLayoutFor;

/**
 * IMIP 的行业部门与分包商。
 * 必须在 loadDict() 之前跑完，否则演示数据分配不到这些部门。
 */
export async function seedImipOrg(prisma: PrismaClient) {
  await prisma.department.createMany({
    data: [
      ['SMELT', '镍铁冶炼厂', 'Ferronickel Smelter', 'Pabrik Peleburan Feronikel'],
      ['STEEL', '不锈钢炼钢厂', 'Stainless Steel Plant', 'Pabrik Baja Nirkarat'],
      ['POWER', '电厂', 'Power Plant', 'Pembangkit Listrik'],
      ['COKE', '焦化厂', 'Coking Plant', 'Pabrik Kokas'],
      ['PORT', '港务部', 'Port Operations', 'Operasi Pelabuhan'],
      ['EQUIP', '设备动力部', 'Equipment & Utilities', 'Peralatan & Utilitas'],
      ['CONST', '工程建设部', 'Construction', 'Konstruksi'],
    ].map(([code, zh, en, id], i) => ({ code, nameZh: zh, nameEn: en, nameId: id, sortOrder: 100 + i })),
  });

  await prisma.contractor.createMany({
    data: [
      { code: 'PT-BKS', name: 'PT. Bintang Karya Sulawesi', contact: 'Hendra', phone: '+62 812-3456-7801' },
      { code: 'PT-MJP', name: 'PT. Morowali Jaya Perkasa', contact: 'Agus', phone: '+62 812-3456-7802' },
      { code: 'CN-CONST', name: '中建海外工程分包', contact: '刘工', phone: '+62 812-3456-7803' },
    ],
  });

  await prisma.settingItem.updateMany({
    where: { key: 'org.name' },
    data: { value: JSON.stringify('青山工业园区（IMIP）') },
  });
}

/** 生成楼栋 / 楼层 / 房间 / 床位 / 资产 */
export async function seedImipSpace(prisma: PrismaClient, dict: Dict): Promise<Space> {
  const { rtByCode, roomTypes } = dict;
  console.log('生成楼栋 / 楼层 / 房间 / 床位…');
  const site = await prisma.site.create({
    data: { code: 'IMIP', name: '青山工业园区（IMIP）', address: 'Bahodopi, Morowali, Sulawesi Tengah, Indonesia' },
  });

  const roomRows: any[] = [];
  const buildingIds: Record<string, number> = {};

  for (const [bi, cfg] of BUILDINGS.entries()) {
    const building = await prisma.building.create({
      data: {
        siteId: site.id, code: cfg.code, name: cfg.name,
        genderPolicy: cfg.gender, nationalityId: cfg.nationality,
        hasElevator: cfg.hasElevator ?? false,
        note: cfg.note, sortOrder: bi,
      },
    });
    buildingIds[cfg.code] = building.id;

    for (let lv = 1; lv <= cfg.floors; lv++) {
      const floorNat = cfg.floorNationality ? (cfg.floorNationality[lv] ?? null) : null;
      const floor = await prisma.floor.create({
        data: { buildingId: building.id, level: lv, name: `${lv} 层`, nationalityId: floorNat },
      });

      const mixEntries = Object.entries(cfg.mix) as [string, number][];
      let seq = 0;

      // 住宿房间
      for (let r = 1; r <= cfg.roomsPerFloor; r++) {
        seq++;
        const typeCode = weighted(mixEntries);
        const rt = rtByCode[typeCode];
        const roomNo = lv * 100 + seq;
        const code = `${cfg.code}-${roomNo}`;

        // 核定人数：多数等于标称；一部分降标（四人间按三人住、六人间按五人住）
        let capacity = rt.defaultCapacity;
        let deratedReason: string | null = null;
        if (rt.defaultCapacity >= 4 && rt.isResidential && chance(0.22)) {
          capacity = rt.defaultCapacity - 1;
          deratedReason = pick([
            '空调制冷量不足，按低一档人数配置',
            '房间面积偏小，安全通道要求降标',
            '一张床架损坏已撤除，暂按低一档配置',
            '员工投诉过于拥挤，主管批准降标',
          ]);
        }

        const status =
          typeCode === 'QUARANTINE' ? 'LOCKED'
          : chance(0.02) ? 'MAINTENANCE'
          : chance(0.01) ? 'CLEANING'
          : 'AVAILABLE';

        roomRows.push({
          floorId: floor.id, code, name: `${roomNo} 房`, roomTypeId: rt.id,
          capacity, deratedReason, status,
          hasAC: ['DOUBLE', 'SINGLE', 'CADRE', 'EXPERT', 'HOTEL', 'COUPLE', 'FAMILY'].includes(typeCode) || chance(0.35),
          hasBathroom: ['DOUBLE', 'SINGLE', 'CADRE', 'EXPERT', 'HOTEL', 'COUPLE', 'FAMILY', 'QUAD', 'TRIPLE'].includes(typeCode),
          hasWaterHeater: ['CADRE', 'EXPERT', 'HOTEL', 'COUPLE', 'FAMILY'].includes(typeCode) || chance(0.2),
          hasBalcony: chance(0.25),
          orientation: pick(['南', '北', '东', '西']),
          area: Math.max(rt.defaultCapacity, 1) * 4.5 + randInt(0, 8),
          _typeCode: typeCode,
        });
      }

      // 功能房
      for (const fr of FLOOR_FUNCTION_ROOMS) {
        if (fr.onFloor === 'FIRST' && lv !== 1) continue;
        if (fr.type === 'PRAYER' && !(cfg.nationality === 'ID' || cfg.floorNationality)) continue;
        seq++;
        const rt = rtByCode[fr.type];
        const roomNo = lv * 100 + seq;
        roomRows.push({
          floorId: floor.id, code: `${cfg.code}-${roomNo}`, name: rt.nameZh,
          roomTypeId: rt.id, capacity: 0, status: 'AVAILABLE',
          hasAC: fr.type === 'DORM_OFFICE', hasBathroom: false,
          area: randInt(12, 40), _typeCode: fr.type,
        });
      }
    }
  }

  const roomTypeCodeByIndex = roomRows.map((r) => r._typeCode);
  await createManyChunked(prisma.room, roomRows.map(({ _typeCode, ...r }) => r));

  // 床位：按房型标称摆床，超出核定人数的部分标记为 DISABLED（撤除留痕）
  const rooms = await prisma.room.findMany({
    select: { id: true, code: true, capacity: true, roomTypeId: true },
    orderBy: { id: 'asc' },
  });
  const rtById: Record<number, any> = Object.fromEntries(roomTypes.map((r) => [r.id, r]));
  const bedRows: any[] = [];
  for (const room of rooms) {
    const rt = rtById[room.roomTypeId];
    if (!rt.isResidential) continue;
    const layout = bedLayout(rt.defaultCapacity, rt.code);
    layout.forEach((b, i) => {
      const beyond = i >= room.capacity;
      bedRows.push({
        roomId: room.id, code: `${room.code}-${i + 1}`, label: b.label,
        position: b.position,
        status: beyond ? 'DISABLED' : 'FREE',
        note: beyond ? '按核定人数降标撤除' : null,
      });
    });
  }
  await createManyChunked(prisma.bed, bedRows);

  // 房间固定资产
  const assetRows: any[] = [];
  const allRoomsFull = await prisma.room.findMany({ include: { roomType: true } });
  for (const room of allRoomsFull) {
    if (!room.roomType.isResidential) continue;
    if (room.hasAC) assetRows.push({ roomId: room.id, category: 'AC', name: '壁挂空调', assetNo: `AC-${room.code}`, status: chance(0.05) ? 'BROKEN' : 'NORMAL' });
    else assetRows.push({ roomId: room.id, category: 'FAN', name: '吊扇', assetNo: `FAN-${room.code}`, status: 'NORMAL' });
    if (room.hasWaterHeater) assetRows.push({ roomId: room.id, category: 'WATER_HEATER', name: '电热水器', assetNo: `WH-${room.code}`, status: chance(0.06) ? 'BROKEN' : 'NORMAL' });
    assetRows.push({ roomId: room.id, category: 'DESK', name: '书桌椅', assetNo: `DK-${room.code}`, status: 'NORMAL' });
  }
  await createManyChunked(prisma.asset, assetRows);
  console.log(`  楼栋 ${BUILDINGS.length} / 房间 ${roomRows.length}（含功能房 ${roomTypeCodeByIndex.filter((c) => !rtByCode[c].isResidential).length}）/ 床位 ${bedRows.length} / 资产 ${assetRows.length}`);

  // ============================== 人员 ==============================
  return { site, buildingIds, roomRows, bedRows, allRoomsFull };
}
