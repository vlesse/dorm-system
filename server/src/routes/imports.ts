import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requirePerm, audit, actor } from '../services/auth.js';
import { bedLayoutFor } from '../services/space.js';
import { notify } from '../services/notify.js';

/**
 * 人工批量导入。
 *
 * 和「集成对接 → 人员同步」是两条腿：系统对接不上、或者还没对接时，
 * 宿管拿 Excel / CSV 也能把数据灌进来。两边最后都落到同一张 SyncLog。
 *
 * 设计要点：
 *   1. 字段定义（模板表头、必填、字典可选值、示例）只有这一份，
 *      模板下载、前端字段说明、后端校验全都读它，不会对不上。
 *   2. 必须先「预检」再「导入」：预检不写库，逐行返回新增 / 更新 / 报错原因，
 *      让人看清楚了再提交。有错的行可以跳过，不必整批失败。
 *   3. 导入入住分配时会跑一遍排宿规则，硬约束不通过的行直接判错。
 */

type DictName =
  | 'nationality' | 'department' | 'positionLevel' | 'shift' | 'contractor' | 'religion'
  | 'roomType' | 'gender' | 'idType' | 'employmentStatus' | 'personType' | 'boolean' | 'genderPolicy';

interface Field {
  key: string;
  label: string;
  required?: boolean;
  dict?: DictName;
  hint?: string;
  example: string;
}

interface ImportType {
  type: string;
  nameZh: string;
  desc: string;
  perm: string;
  fields: Field[];
}

// 固定枚举的中文↔内部值映射
const ENUMS: Record<string, Record<string, string>> = {
  gender: { 男: 'MALE', 女: 'FEMALE', MALE: 'MALE', FEMALE: 'FEMALE' },
  idType: { 护照: 'PASSPORT', KTP: 'KTP', KITAS: 'KITAS', 其他: 'OTHER', PASSPORT: 'PASSPORT', OTHER: 'OTHER' },
  employmentStatus: {
    在职: 'ACTIVE', 休假中: 'ON_LEAVE', 出差: 'BUSINESS_TRIP', 住院: 'HOSPITALIZED', 已离职: 'RESIGNED',
    ACTIVE: 'ACTIVE', ON_LEAVE: 'ON_LEAVE', BUSINESS_TRIP: 'BUSINESS_TRIP', HOSPITALIZED: 'HOSPITALIZED', RESIGNED: 'RESIGNED',
  },
  personType: {
    员工: 'EMPLOYEE', 家属随迁: 'DEPENDENT', 长期访客: 'VISITOR', 实习生: 'INTERN',
    EMPLOYEE: 'EMPLOYEE', DEPENDENT: 'DEPENDENT', VISITOR: 'VISITOR', INTERN: 'INTERN',
  },
  boolean: { 是: 'true', 否: 'false', true: 'true', false: 'false', Y: 'true', N: 'false', '1': 'true', '0': 'false' },
  genderPolicy: { 男: 'MALE', 女: 'FEMALE', 混住: 'MIXED', MALE: 'MALE', FEMALE: 'FEMALE', MIXED: 'MIXED' },
};

const TYPES: ImportType[] = [
  {
    type: 'persons',
    nameZh: '人员花名册',
    desc: '导入员工与家属。已存在的工号会更新，不存在的新建。把某人改成「已离职」时，若他还占着床位，系统会自动生成退宿待办并通知宿管。',
    perm: 'person:write',
    fields: [
      { key: 'employeeNo', label: '工号', required: true, example: 'CN10001', hint: '唯一标识，重复即视为更新同一人' },
      { key: 'name', label: '姓名', required: true, example: '张伟' },
      { key: 'personType', label: '人员类型', dict: 'personType', example: '员工', hint: '留空按「员工」' },
      { key: 'gender', label: '性别', required: true, dict: 'gender', example: '男' },
      { key: 'nationalityId', label: '国籍', required: true, dict: 'nationality', example: '中国' },
      { key: 'idType', label: '证件类型', dict: 'idType', example: '护照' },
      { key: 'idNumber', label: '证件号', required: true, example: 'E12345678' },
      { key: 'idExpiryDate', label: '证件到期日', example: '2028-05-30', hint: 'YYYY-MM-DD，护照/KITAS 到期会进告警' },
      { key: 'departmentId', label: '部门', dict: 'department', example: '镍铁冶炼厂' },
      { key: 'positionLevelId', label: '职级', dict: 'positionLevel', example: '普通员工' },
      { key: 'shiftId', label: '班次', dict: 'shift', example: '白班' },
      { key: 'contractorId', label: '雇佣主体', dict: 'contractor', example: '本公司自有员工' },
      { key: 'religionId', label: '宗教信仰', dict: 'religion', example: '无 / 未登记', hint: '影响饮食禁忌排宿规则' },
      { key: 'phone', label: '手机号', example: '+62 812-3456-7890', hint: '自助端登录验证码发到这里' },
      { key: 'emergencyContact', label: '紧急联系人', example: '张建国' },
      { key: 'emergencyPhone', label: '紧急联系电话', example: '+62 813-0000-0000' },
      { key: 'languages', label: '语言', example: 'zh,en', hint: '逗号分隔：zh 中文 / id 印尼语 / en 英语' },
      { key: 'isSmoker', label: '是否吸烟', dict: 'boolean', example: '否' },
      { key: 'needsLowerBunk', label: '不能睡上铺', dict: 'boolean', example: '否', hint: '年龄/体重/身体原因，会硬性拦截上铺分配' },
      { key: 'needsGroundFloor', label: '需低楼层', dict: 'boolean', example: '否' },
      { key: 'hireDate', label: '入职日期', example: '2024-03-01' },
      { key: 'employmentStatus', label: '在职状态', dict: 'employmentStatus', example: '在职' },
      { key: 'hostEmployeeNo', label: '挂靠员工工号', example: '', hint: '家属随迁必填，填其配偶/家长的工号' },
      { key: 'note', label: '备注', example: '' },
    ],
  },
  {
    type: 'rooms',
    nameZh: '楼栋房间',
    desc: '批量建楼建房。楼栋和楼层不存在会自动创建；房间号已存在则更新。新建房间会按房型自动摆好床位（上下铺、双人床都按规格来）。',
    perm: 'space:write',
    fields: [
      { key: 'buildingCode', label: '楼栋编码', required: true, example: 'J', hint: '不存在会自动新建' },
      { key: 'buildingName', label: '楼栋名称', example: 'J栋 新建员工宿舍', hint: '仅新建楼栋时使用' },
      { key: 'buildingGender', label: '楼栋性别策略', dict: 'genderPolicy', example: '男' },
      { key: 'buildingNationality', label: '楼栋国籍归属', dict: 'nationality', example: '', hint: '留空=不限' },
      { key: 'hasElevator', label: '有无电梯', dict: 'boolean', example: '否' },
      { key: 'floorLevel', label: '楼层', required: true, example: '3' },
      { key: 'floorNationality', label: '本层国籍归属', dict: 'nationality', example: '', hint: '留空=跟随楼栋。支持「一二层印尼籍、三层中方」' },
      { key: 'roomCode', label: '房间号', required: true, example: 'J-301', hint: '全系统唯一' },
      { key: 'roomTypeId', label: '房型', required: true, dict: 'roomType', example: '六人间' },
      { key: 'capacity', label: '核定人数', example: '5', hint: '留空=房型标称。填小于标称即为降标，多余床位自动撤除' },
      { key: 'deratedReason', label: '降标原因', example: '', hint: '核定人数小于标称时建议填写' },
      { key: 'hasAC', label: '空调', dict: 'boolean', example: '是' },
      { key: 'hasBathroom', label: '独立卫浴', dict: 'boolean', example: '是' },
      { key: 'hasWaterHeater', label: '热水器', dict: 'boolean', example: '否' },
      { key: 'hasBalcony', label: '阳台', dict: 'boolean', example: '否' },
      { key: 'orientation', label: '朝向', example: '南' },
      { key: 'area', label: '面积(㎡)', example: '32' },
    ],
  },
  {
    type: 'occupancy',
    nameZh: '入住分配',
    desc: '批量把人安排进房间。床位号留空的，系统会在该房间里挑一张合适的空床。导入时会跑一遍排宿规则：硬约束不通过的行直接判错，软约束不通过只提醒。',
    perm: 'allocation:write',
    fields: [
      { key: 'employeeNo', label: '工号', required: true, example: 'CN10001' },
      { key: 'roomCode', label: '房间号', required: true, example: 'A-301' },
      { key: 'bedLabel', label: '床位', example: '', hint: '如「1 下铺」。留空则自动挑一张空床' },
      { key: 'checkInAt', label: '入住日期', example: '2026-09-01', hint: '留空按今天' },
      { key: 'note', label: '备注', example: '' },
    ],
  },
];

const truthy = (v: string) => ENUMS.boolean[String(v).trim()] === 'true';

export default async function importRoutes(app: FastifyInstance) {
  /** 导入类型定义 + 字典可选值 —— 前端据此渲染字段说明并生成模板 */
  app.get('/api/import/schema', async () => {
    const [nats, depts, levels, shifts, contractors, religions, roomTypes] = await Promise.all([
      prisma.nationality.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.positionLevel.findMany({ where: { isActive: true }, orderBy: { rank: 'asc' } }),
      prisma.shift.findMany({ where: { isActive: true } }),
      prisma.contractor.findMany({ where: { isActive: true } }),
      prisma.religion.findMany({ where: { isActive: true } }),
      prisma.roomType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);
    const dicts: Record<string, string[]> = {
      nationality: nats.map((x) => x.nameZh),
      department: depts.map((x) => x.nameZh),
      positionLevel: levels.map((x) => x.nameZh),
      shift: shifts.map((x) => x.nameZh),
      contractor: contractors.map((x) => x.name),
      religion: religions.map((x) => x.nameZh),
      roomType: roomTypes.map((x) => x.nameZh),
      gender: ['男', '女'],
      idType: ['护照', 'KTP', 'KITAS', '其他'],
      employmentStatus: ['在职', '休假中', '出差', '住院', '已离职'],
      personType: ['员工', '家属随迁', '长期访客', '实习生'],
      genderPolicy: ['男', '女', '混住'],
      boolean: ['是', '否'],
    };
    return { types: TYPES, dicts };
  });

  /** 预检：不写库，逐行给结论 */
  app.post<{ Params: { type: string }; Body: { rows: Record<string, any>[] } }>(
    '/api/import/:type/preview',
    { preHandler: requirePerm('person:read') },
    async (req, reply) => {
      const def = TYPES.find((t) => t.type === req.params.type);
      if (!def) return reply.code(404).send({ error: '未知导入类型' });
      const rows = req.body?.rows ?? [];
      if (!Array.isArray(rows) || rows.length === 0) return reply.code(400).send({ error: '没有可导入的数据' });
      if (rows.length > 5000) return reply.code(400).send({ error: '单次最多导入 5000 行，请分批' });
      return { type: def.type, results: await validateRows(def, rows) };
    }
  );

  /** 提交导入。onlyValid=true 时跳过有错的行，其余照常导入 */
  app.post<{ Params: { type: string }; Body: { rows: Record<string, any>[]; onlyValid?: boolean } }>(
    '/api/import/:type/commit',
    async (req, reply) => {
      const def = TYPES.find((t) => t.type === req.params.type);
      if (!def) return reply.code(404).send({ error: '未知导入类型' });
      // 每种导入各自的权限
      if (!req.auth || (req.auth.kind !== 'USER')) return reply.code(403).send({ error: '无权导入' });
      const { hasPermission } = await import('../services/auth.js');
      if (!hasPermission(req.auth.perms, def.perm)) {
        return reply.code(403).send({ error: `没有「${def.perm}」权限`, needed: def.perm });
      }

      const rows = req.body?.rows ?? [];
      const onlyValid = req.body?.onlyValid !== false;
      const results = await validateRows(def, rows);
      const bad = results.filter((r) => r.status === 'ERROR');
      if (bad.length > 0 && !onlyValid) {
        return reply.code(400).send({ error: `有 ${bad.length} 行校验不通过`, results });
      }

      const log = await prisma.syncLog.create({
        data: { provider: 'MANUAL', kind: def.type.toUpperCase(), operator: actor(req) },
      });

      let created = 0, updated = 0, deactivated = 0, failed = 0;
      const problems: string[] = [];

      for (const r of results) {
        // 校验不通过的只记在 skipped 里，不要再算进 failed（那是写库时才出的错）
        if (r.status === 'ERROR') continue;
        try {
          const out = await applyRow(def, r);
          if (out === 'CREATED') created++;
          else if (out === 'UPDATED') updated++;
          if (r.triggersCheckout) deactivated++;
        } catch (e: any) {
          failed++;
          problems.push(`第 ${r.line} 行：${e.message}`);
        }
      }

      const done = await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          finishedAt: new Date(), status: failed > 0 && created + updated === 0 ? 'FAILED' : 'SUCCESS',
          created, updated, deactivated,
          message: [
            bad.length ? `跳过 ${bad.length} 行校验不通过的数据` : null,
            ...problems.slice(0, 20),
          ].filter(Boolean).join('; ') || null,
        },
      });
      await audit(req, 'IMPORT', {
        targetType: def.type,
        detail: `${def.nameZh}：新增 ${created} 更新 ${updated} 跳过 ${bad.length} 失败 ${failed}`,
      });
      return { ...done, skipped: bad.length, failed };
    }
  );
}

// ==================================================== 校验

interface RowResult {
  line: number;
  status: 'CREATE' | 'UPDATE' | 'ERROR';
  errors: string[];
  warnings: string[];
  /** 解析并转换后的数据，提交时直接用 */
  data: Record<string, any>;
  label: string;
  triggersCheckout?: boolean;
}

async function validateRows(def: ImportType, rows: Record<string, any>[]): Promise<RowResult[]> {
  // 一次性把字典读进来，避免逐行查库
  const [nats, depts, levels, shifts, contractors, religions, roomTypes, buildings] = await Promise.all([
    prisma.nationality.findMany(),
    prisma.department.findMany(),
    prisma.positionLevel.findMany(),
    prisma.shift.findMany(),
    prisma.contractor.findMany(),
    prisma.religion.findMany(),
    prisma.roomType.findMany(),
    prisma.building.findMany(),
  ]);
  const byName = <T extends { nameZh?: string; name?: string; code?: string; id: any }>(list: T[], v: string) =>
    list.find((x: any) => x.nameZh === v || x.name === v || x.code === v || String(x.id) === v);

  const out: RowResult[] = [];
  const seen = new Set<string>();

  for (const [i, raw] of rows.entries()) {
    const line = i + 2; // 表头占第 1 行
    const errors: string[] = [];
    const warnings: string[] = [];
    const data: Record<string, any> = {};
    const val = (k: string) => String(raw[k] ?? '').trim();

    // 必填
    for (const f of def.fields) {
      if (f.required && !val(f.key)) errors.push(`「${f.label}」必填`);
    }

    if (def.type === 'persons') {
      const employeeNo = val('employeeNo');
      if (seen.has(employeeNo)) errors.push(`工号 ${employeeNo} 在本次导入中重复`);
      seen.add(employeeNo);

      data.employeeNo = employeeNo;
      data.name = val('name');
      data.personType = ENUMS.personType[val('personType')] ?? 'EMPLOYEE';
      data.gender = ENUMS.gender[val('gender')];
      if (val('gender') && !data.gender) errors.push(`性别「${val('gender')}」无法识别，应为 男/女`);

      const nat = byName(nats, val('nationalityId'));
      if (val('nationalityId') && !nat) errors.push(`国籍「${val('nationalityId')}」不在字典里`);
      else if (nat) data.nationalityId = nat.id;

      data.idType = ENUMS.idType[val('idType')] ?? 'PASSPORT';
      data.idNumber = val('idNumber');

      for (const [k, list, label] of [
        ['departmentId', depts, '部门'], ['positionLevelId', levels, '职级'],
        ['shiftId', shifts, '班次'], ['contractorId', contractors, '雇佣主体'],
        ['religionId', religions, '宗教信仰'],
      ] as const) {
        const v = val(k);
        if (!v) continue;
        const hit = byName(list as any[], v);
        if (!hit) errors.push(`${label}「${v}」不在字典里`);
        else data[k] = hit.id;
      }

      for (const [k, label] of [['idExpiryDate', '证件到期日'], ['hireDate', '入职日期']] as const) {
        const v = val(k);
        if (!v) continue;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) errors.push(`${label}「${v}」不是有效日期（应为 YYYY-MM-DD）`);
        else data[k] = d;
      }

      for (const k of ['phone', 'emergencyContact', 'emergencyPhone', 'languages', 'note']) {
        if (val(k)) data[k] = val(k);
      }
      for (const k of ['isSmoker', 'needsLowerBunk', 'needsGroundFloor']) {
        if (val(k)) data[k] = truthy(val(k));
      }
      if (val('employmentStatus')) {
        const st = ENUMS.employmentStatus[val('employmentStatus')];
        if (!st) errors.push(`在职状态「${val('employmentStatus')}」无法识别`);
        else data.employmentStatus = st;
      }

      const host = val('hostEmployeeNo');
      if (host) {
        const h = await prisma.person.findUnique({ where: { employeeNo: host } });
        if (!h) errors.push(`挂靠员工工号 ${host} 不存在`);
        else data.hostPersonId = h.id;
      } else if (data.personType === 'DEPENDENT') {
        errors.push('家属随迁必须填「挂靠员工工号」');
      }

      const exists = employeeNo ? await prisma.person.findUnique({ where: { employeeNo } }) : null;
      // 新建时国籍/性别/证件号必须齐
      if (!exists) {
        for (const [k, label] of [['nationalityId', '国籍'], ['gender', '性别'], ['idNumber', '证件号']] as const) {
          if (!data[k]) errors.push(`新建人员时「${label}」必填`);
        }
      }
      const willResign = data.employmentStatus === 'RESIGNED' && exists && exists.employmentStatus !== 'RESIGNED';
      let triggersCheckout = false;
      if (willResign) {
        const occ = await prisma.occupancy.count({
          where: { personId: exists!.id, status: { in: ['ACTIVE', 'HELD', 'RESERVED'] } },
        });
        if (occ > 0) { triggersCheckout = true; warnings.push('该人员将被标记离职，且仍占用床位 —— 会自动生成退宿待办'); }
      }

      out.push({
        line, status: errors.length ? 'ERROR' : exists ? 'UPDATE' : 'CREATE',
        errors, warnings, data, label: `${employeeNo} ${data.name ?? ''}`, triggersCheckout,
      });
      continue;
    }

    if (def.type === 'rooms') {
      const roomCode = val('roomCode');
      if (seen.has(roomCode)) errors.push(`房间号 ${roomCode} 在本次导入中重复`);
      seen.add(roomCode);

      data.buildingCode = val('buildingCode');
      data.buildingName = val('buildingName') || `${val('buildingCode')}栋`;
      data.buildingGender = ENUMS.genderPolicy[val('buildingGender')] ?? 'MIXED';
      data.hasElevator = val('hasElevator') ? truthy(val('hasElevator')) : false;
      data.roomCode = roomCode;

      const lvl = Number(val('floorLevel'));
      if (!Number.isInteger(lvl) || lvl < 1 || lvl > 60) errors.push(`楼层「${val('floorLevel')}」应为 1~60 的整数`);
      else data.floorLevel = lvl;

      const rt = byName(roomTypes, val('roomTypeId'));
      if (val('roomTypeId') && !rt) errors.push(`房型「${val('roomTypeId')}」不在字典里`);
      else if (rt) { data.roomTypeId = rt.id; data.nominal = rt.defaultCapacity; data.roomTypeCode = rt.code; data.isResidential = rt.isResidential; }

      for (const [k, label] of [['buildingNationality', '楼栋国籍归属'], ['floorNationality', '本层国籍归属']] as const) {
        const v = val(k);
        if (!v) continue;
        const hit = byName(nats, v);
        if (!hit) errors.push(`${label}「${v}」不在字典里`);
        else data[k] = hit.id;
      }

      if (val('capacity')) {
        const c = Number(val('capacity'));
        if (!Number.isInteger(c) || c < 0) errors.push(`核定人数「${val('capacity')}」应为非负整数`);
        else if (rt && c > rt.defaultCapacity + 4) errors.push(`核定人数 ${c} 超过房型标称 ${rt.defaultCapacity} 太多`);
        else data.capacity = c;
      }
      if (val('deratedReason')) data.deratedReason = val('deratedReason');
      for (const k of ['hasAC', 'hasBathroom', 'hasWaterHeater', 'hasBalcony']) {
        if (val(k)) data[k] = truthy(val(k));
      }
      if (val('orientation')) data.orientation = val('orientation');
      if (val('area')) {
        const a = Number(val('area'));
        if (Number.isNaN(a)) errors.push(`面积「${val('area')}」不是数字`);
        else data.area = a;
      }

      const exists = roomCode ? await prisma.room.findUnique({ where: { code: roomCode } }) : null;
      const bldExists = buildings.find((b) => b.code === data.buildingCode);
      if (!bldExists) warnings.push(`楼栋 ${data.buildingCode} 不存在，将自动新建`);

      out.push({
        line, status: errors.length ? 'ERROR' : exists ? 'UPDATE' : 'CREATE',
        errors, warnings, data, label: `${roomCode} ${val('roomTypeId')}`,
      });
      continue;
    }

    if (def.type === 'occupancy') {
      const employeeNo = val('employeeNo');
      const roomCode = val('roomCode');
      if (seen.has(employeeNo)) errors.push(`工号 ${employeeNo} 在本次导入中重复`);
      seen.add(employeeNo);

      const person = employeeNo
        ? await prisma.person.findUnique({
            where: { employeeNo },
            include: { positionLevel: true, contractor: true, religion: true, occupancies: { where: { status: { in: ['ACTIVE', 'HELD', 'RESERVED'] } } } },
          })
        : null;
      if (employeeNo && !person) errors.push(`工号 ${employeeNo} 不存在，请先导入人员`);
      if (person?.employmentStatus === 'RESIGNED') errors.push('该人员已离职，不能分配床位');
      if (person && person.occupancies.length > 0) errors.push('该人员已有在住床位，批量导入不做调宿');

      const room = roomCode
        ? await prisma.room.findUnique({
            where: { code: roomCode },
            include: {
              roomType: true, floor: { include: { building: true } },
              beds: { include: { occupancies: { where: { status: { in: ['ACTIVE', 'HELD', 'RESERVED'] } } } } },
            },
          })
        : null;
      if (roomCode && !room) errors.push(`房间号 ${roomCode} 不存在`);

      let bed: any = null;
      if (room) {
        const free = room.beds.filter((b) => b.status === 'FREE');
        const want = val('bedLabel');
        if (want) {
          bed = room.beds.find((b) => b.label === want || b.code === want);
          if (!bed) errors.push(`房间 ${roomCode} 里没有床位「${want}」`);
          else if (bed.status !== 'FREE') errors.push(`床位「${want}」当前状态为 ${bed.status}，不可分配`);
        } else {
          bed = free[0];
          if (!bed) errors.push(`房间 ${roomCode} 没有空床`);
        }
      }

      // 跑一遍排宿规则
      if (person && room && bed && errors.length === 0) {
        const { evaluateAssignment, splitChecks } = await import('../services/rules.js');
        const { personToLike, roomToContext, spouseIdsOf } = await import('../services/space.js');
        const { loadRules } = await import('../db.js');
        const rules = await loadRules();
        const spouseIds = await spouseIdsOf(person.id);
        const checks = evaluateAssignment(
          personToLike(person, spouseIds),
          roomToContext({ ...room, beds: room.beds.map((b) => ({ ...b, occupancies: [] })) }, bed),
          rules
        );
        const { blockers, warnings: warn } = splitChecks(checks);
        for (const b of blockers) errors.push(b.message);
        for (const w of warn) warnings.push(w.message);
      }

      if (val('checkInAt')) {
        const d = new Date(val('checkInAt'));
        if (Number.isNaN(d.getTime())) errors.push(`入住日期「${val('checkInAt')}」无效`);
        else data.checkInAt = d;
      }
      data.personId = person?.id;
      data.bedId = bed?.id;
      if (val('note')) data.note = val('note');

      out.push({
        line, status: errors.length ? 'ERROR' : 'CREATE',
        errors, warnings, data,
        label: `${employeeNo} → ${roomCode}${bed ? ' · ' + bed.label : ''}`,
      });
      continue;
    }
  }
  return out;
}

// ==================================================== 落库

async function applyRow(def: ImportType, r: RowResult): Promise<'CREATED' | 'UPDATED'> {
  const d = r.data;

  if (def.type === 'persons') {
    const exists = await prisma.person.findUnique({ where: { employeeNo: d.employeeNo } });
    if (exists) {
      const { employeeNo, ...rest } = d;
      await prisma.person.update({ where: { id: exists.id }, data: rest });
      if (r.triggersCheckout) {
        const occ = await prisma.occupancy.findFirst({
          where: { personId: exists.id, status: { in: ['ACTIVE', 'HELD', 'RESERVED'] } },
          include: { bed: { include: { room: true } } },
        });
        if (occ) {
          await prisma.request.create({
            data: {
              code: `REQ${Date.now().toString().slice(-8)}${exists.id % 100}`,
              type: 'CHECKOUT', personId: exists.id,
              reason: '批量导入标记离职，需办理退宿并清点物品',
              status: 'APPROVED', submittedBy: 'import:manual',
              approvedBy: 'system', approvedAt: new Date(),
            },
          });
          await notify('RESIGNED_CHECKOUT', { roleCode: 'WARDEN' }, {
            name: exists.name, employeeNo: exists.employeeNo, room: occ.bed.room.code,
          }, { type: 'PERSON', id: exists.id, linkPath: '/alerts' });
        }
      }
      return 'UPDATED';
    }
    await prisma.person.create({ data: { hireDate: new Date(), ...d } as any });
    return 'CREATED';
  }

  if (def.type === 'rooms') {
    const site = await prisma.site.findFirst();
    let building = await prisma.building.findUnique({ where: { code: d.buildingCode } });
    if (!building) {
      building = await prisma.building.create({
        data: {
          siteId: site!.id, code: d.buildingCode, name: d.buildingName,
          genderPolicy: d.buildingGender ?? 'MIXED',
          nationalityId: d.buildingNationality ?? null,
          hasElevator: !!d.hasElevator,
          sortOrder: await prisma.building.count(),
        },
      });
    }
    let floor = await prisma.floor.findUnique({
      where: { buildingId_level: { buildingId: building.id, level: d.floorLevel } },
    });
    if (!floor) {
      floor = await prisma.floor.create({
        data: {
          buildingId: building.id, level: d.floorLevel, name: `${d.floorLevel} 层`,
          nationalityId: d.floorNationality ?? null,
        },
      });
    } else if (d.floorNationality) {
      await prisma.floor.update({ where: { id: floor.id }, data: { nationalityId: d.floorNationality } });
    }

    const capacity = d.capacity ?? d.nominal ?? 6;
    const roomData: any = {
      floorId: floor.id, code: d.roomCode, name: `${d.roomCode.split('-')[1] ?? d.roomCode} 房`,
      roomTypeId: d.roomTypeId, capacity,
      deratedReason: d.deratedReason ?? (capacity < (d.nominal ?? capacity) ? '导入时降标' : null),
      hasAC: d.hasAC ?? false, hasBathroom: d.hasBathroom ?? false,
      hasWaterHeater: d.hasWaterHeater ?? false, hasBalcony: d.hasBalcony ?? false,
      orientation: d.orientation ?? null, area: d.area ?? null,
    };

    const exists = await prisma.room.findUnique({ where: { code: d.roomCode } });
    if (exists) {
      const { floorId, code, name, ...rest } = roomData;
      await prisma.room.update({ where: { id: exists.id }, data: rest });
      return 'UPDATED';
    }

    const room = await prisma.room.create({ data: roomData });
    // 按房型摆床：上下铺 / 单床 / 双人床都按规格来，超出核定的自动标记撤除
    if (d.isResidential) {
      const layout = bedLayoutFor(d.nominal ?? capacity, d.roomTypeCode ?? '');
      await prisma.bed.createMany({
        data: layout.map((b, i) => ({
          roomId: room.id, code: `${room.code}-${i + 1}`, label: b.label, position: b.position,
          status: i >= capacity ? 'DISABLED' : 'FREE',
          note: i >= capacity ? '按核定人数降标撤除' : null,
        })),
      });
    }
    return 'CREATED';
  }

  if (def.type === 'occupancy') {
    await prisma.$transaction(async (tx) => {
      await tx.occupancy.create({
        data: {
          bedId: d.bedId, personId: d.personId, status: 'ACTIVE',
          checkInAt: d.checkInAt ?? new Date(),
          assignedBy: 'import:manual', note: d.note ?? null,
        },
      });
      await tx.bed.update({ where: { id: d.bedId }, data: { status: 'OCCUPIED' } });
      await tx.occupancyEvent.create({
        data: { type: 'CHECKIN', personId: d.personId, bedId: d.bedId, operator: 'import:manual', note: '批量导入' },
      });
    });
    return 'CREATED';
  }

  throw new Error('未知导入类型');
}
