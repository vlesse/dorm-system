# 数据模型

数据模型是这套系统里最难改的部分，也是最值得先看懂的部分。
权威定义在 [`server/prisma/schema.prisma`](../server/prisma/schema.prisma)（全中文注释），
这份文档讲**表之间的关系**和**几个关键建模决策的原因**。

- [总览](#总览)
- [空间](#空间)
- [人员](#人员)
- [入住](#入住)
- [运营](#运营)
- [投诉](#投诉)
- [平台与系统](#平台与系统)
- [五个关键建模决策](#五个关键建模决策)
- [切换到 PostgreSQL](#切换到-postgresql)

---

## 总览

42 张表，分五组：

| 组 | 表 |
|---|---|
| **字典** | `Nationality` `Department` `PositionLevel` `Shift` `Contractor` `Religion` `RoomType` `ItemType` `ViolationType` `WorkOrderCategory` `ComplaintType` `SettingItem` |
| **空间** | `Site` `Building` `Floor` `Room` `Bed` `Asset` |
| **人员与入住** | `Person` `Relationship` `Occupancy` `OccupancyEvent` `Request` `IssuedItem` `Deposit` |
| **运营** | `WorkOrder` `Violation` `Visitor` `Inspection` `InspectionItem` `Announcement` |
| **投诉** | `Complaint` `ComplaintEvent` `ComplaintAttachment` |
| **账号与平台** | `Role` `User` `UserBuilding` `IdentityBinding` `Integration` `NotificationTemplate` `Notification` `SyncLog` `AuditLog` `OtpCode` `Device` |

---

## 空间

```
Site 园区
 └─ Building 楼栋          code, name, floorCount
    │                      nationalityId?  genderPolicy?     ← 策略，可空
    └─ Floor 楼层           level
       │                   nationalityId?  genderPolicy?     ← 空则继承 Building
       └─ Room 房间          code, roomTypeId, status
          │                nationalityId?  genderPolicy?     ← 空则继承 Floor
          │                capacity            ← 核定人数
          │                deratedReason?      ← 降标原因
          ├─ Bed 床位        bedNo, bedPosition(UPPER/LOWER/SINGLE), status
          └─ Asset 资产      空调、家具，关联工单
```

`Device`（摄像头 / 门禁）挂在 `Building` / `Floor` / `Room` 任一级上，
**目前只存点位，为二期视频接入和门禁联动预留。**

### 策略继承

`nationalityId` 和 `genderPolicy` 在三级上都可为空，取值时**由下往上找第一个非空**：

```
Room.nationalityId ?? Floor.nationalityId ?? Building.nationalityId ?? null(不限)
```

代码在 `services/space.ts` 的 `resolveNationality()` / `resolveGender()`。

这样才能表达「B 栋整栋印尼籍，但三层是中方，三层的 305 房又留给外籍专家」。

---

## 人员

```
Person
 ├─ personType        EMPLOYEE / DEPENDENT / VISITOR / INTERN
 ├─ employmentStatus  ACTIVE / ON_LEAVE / BUSINESS_TRIP / HOSPITALIZED / RESIGNED
 ├─ nationalityId → Nationality
 ├─ departmentId  → Department
 ├─ positionLevelId → PositionLevel   （rank 排序权重 + leaveCycleMonths 休假周期）
 ├─ shiftId       → Shift
 ├─ religionId    → Religion          （含饮食禁忌）
 ├─ contractorId? → Contractor        （空 = 自有员工）
 ├─ 证件：idType, idNumber, idExpiry
 ├─ 排宿约束：canUpperBunk, needsGroundFloor, smoker, languages
 └─ 紧急联系人：emergencyName, emergencyPhone

Relationship  人 ↔ 人
 ├─ type       SPOUSE / CHILD / PARENT / SIBLING / OTHER
 └─ verified   ← 只有 true 才能用于夫妻房
```

`Person` **不只是员工**。家属随迁、长期访客、实习生、承包商工人都在这张表里，
靠 `personType` 区分。消防疏散和房间占用统计必须把他们全算上。

---

## 入住

这是整个模型的核心：

```
Occupancy 入住记录
 ├─ personId   → Person
 ├─ bedId      → Bed
 ├─ checkInAt   DateTime
 ├─ checkOutAt  DateTime?     ← null 表示「当前在住」
 ├─ status      ACTIVE / RESERVED / HELD / ENDED
 └─ note

OccupancyEvent 入住事件流水
 ├─ occupancyId → Occupancy
 ├─ type         ASSIGN / TRANSFER_IN / TRANSFER_OUT / HOLD / RESUME / CHECKOUT
 ├─ operator     ← 取自 JWT，不信前端
 └─ reason
```

**`Occupancy` 永不覆盖、永不删除。**

| 动作 | 对表做了什么 |
|---|---|
| 入住 | 新建一行，`checkOutAt = null` |
| 调宿 | 旧行填上 `checkOutAt` + 新建一行 |
| 挂起 | `status = HELD`，床位仍占着但不算在住 |
| 退宿 | 填上 `checkOutAt`，`status = ENDED` |

「当前在住」= `checkOutAt IS NULL AND status = 'ACTIVE'`。

### 关联表

```
Request      申请：CHECKIN / TRANSFER / CHECKOUT / COUPLE_ROOM / VISITOR_OVERNIGHT / EXTRA_BED
IssuedItem   领用物品，关联 personId + itemTypeId + occupancyId
Deposit      押金
```

`IssuedItem` 关联到 `occupancyId` 而不只是 `personId` —— 这样一个人多次入住的
物品发放能分清是哪一次。

---

## 运营

```
WorkOrder      报修工单 ── categoryId(带 SLA 小时数) ── roomId / assetId
Violation      违规记录 ── violationTypeId(带扣分与罚款)
Visitor        访客登记 ── 留宿走 Request 审批
Inspection     检查/查寝 ── scopeType(BUILDING/FLOOR/ROOM) + scopeId
 └─ InspectionItem  逐项：夜间查寝是逐人点名，卫生检查是逐项打分
Announcement   公告，三语，可按楼栋定向
```

`Inspection` 用 `scopeType + scopeId` 而不是三个可空外键 ——
检查对象可能是整栋、一层或一间，用多态更省事。

---

## 投诉

```
ComplaintType 投诉类别
 ├─ slaHours        处理时限
 ├─ allowAnonymous  是否允许匿名（财物丢失 / 肢体冲突强制实名）
 ├─ routeTo         WARDEN / MANAGER / EHS / HR  ← 见下
 └─ violationTypeId 认定成立后默认转成哪种违规

Complaint 投诉
 ├─ complainantId   投诉人。**匿名投诉这里照样存真人**
 ├─ anonymous       匿名标记
 ├─ targetRoomId    被投诉的房间（选房号不选人）
 ├─ targetFloorId + targetArea   公共区域投诉用
 ├─ occurredFrom / occurredTo    **发生时段**
 ├─ submittedAt     提交时间 ← 和上面是两回事
 ├─ status          NEW → ACCEPTED → INVESTIGATING → SUBSTANTIATED / UNSUBSTANTIATED
 ├─ resolution      认定说明，成立与否都必填
 ├─ violationId     认定成立后生成的违规记录
 ├─ mergedIntoId    重复投诉合并到哪条（原始记录不删）
 └─ rating          投诉人对处理结果的评价

ComplaintEvent 处理流水
 ├─ type            SUBMIT / ACCEPT / INVESTIGATE / RESOLVE / CLOSE /
 │                  COMMENT / MERGE / WITHDRAW / REVEAL_IDENTITY / RATE
 └─ visibleToComplainant   内部核实过程不给投诉人看

ComplaintAttachment 附件
 └─ kind PHOTO / AUDIO，storedName 由服务端生成
```

### 为什么 `Complaint` 和 `Violation` 是两张表

**投诉是一面之词，违规是已查实。** 这是 CONTRIBUTING 里的第四条设计原则。

隔壁半夜吵，可能是真的，也可能是两个房间本来就有矛盾在互相举报。
把两者合表，等于默认「有人说了就是真的」，这个功能三个月内就会被当成整人工具用烂。

分表之后：
- 投诉可以「认定不成立」，而且这个结论本身也留痕、也要给投诉人一个说法
- 违规表里每一条都是查实过的，扣分罚款有据可依
- 从投诉转过来的违规，`description` 和 `evidence` 里带着原投诉编号，能追回去

### 为什么匿名投诉照样存真实 `complainantId`

「匿名」是对**被投诉方和普通宿管**匿名，不是对系统匿名。

不存真人的话：无法回访核实、无法反馈处理结果、无法识别拿匿名刷屏泄愤的人、
也无法做「不同投诉人数」的聚合 —— 而那正是区分「多人独立反映」和「一个人反复投」的唯一依据。

保护靠三层，全在服务端：

1. 列表和详情接口**永远不返回**匿名投诉的投诉人字段（不看权限）
2. 要看必须单独调 `/identity`，需要 `complaint:identity` 权限
3. 每次调用写 `AuditLog` + 一条 `ComplaintEvent`

### 为什么 `routeTo` 在类别上而不是在投诉上

因为**被投诉的可能就是本楼宿管本人**。

「投诉宿舍管理服务」这一类如果落到宿管自己手上，既处理不了，还会把投诉人暴露给他。
所以派发路径必须由类别决定、不可由提交人临时指定，可见性再按它在服务端收口：
没有 `complaint:all` 的人只看得到 `routeTo = 'WARDEN'` 的投诉，
其余的连「存在」都查不到（按 id 直接请求返回 404）。

### 为什么发生时段要和提交时间分开

凌晨两点的噪音，员工第二天早上才来投诉。
只有 `submittedAt` 的话，宿管手里是「上午 9:03」，晚上去查什么都查不到。
有了 `occurredFrom` 才知道该几点去蹲、将来接了监控该调哪一段。

---

## 平台与系统

```
Role            code, name, permissions(JSON 字符串数组)
User            username, passwordHash("salt:hash"), roleId, mustChangePassword
UserBuilding    User ↔ Building  多对多，**楼栋数据范围**
IdentityBinding Person/User ↔ 外部平台身份（provider + externalId）
Integration     15 个平台的配置：provider, capabilities, config(JSON), enabled
NotificationTemplate  code + 三语标题正文
Notification    channel, target, status, error, sentAt
SyncLog         人员同步历史
AuditLog        actor(取自 JWT), action, targetType, targetId, detail, ip
OtpCode         员工端验证码，含过期与已用标记
```

`Role.permissions` 存 JSON 字符串数组（如 `["space:*","allocation:write"]`），
不是关联表 —— 权限点是代码里定义的常量集合，用关联表反而要多维护一张同步的字典。

---

## 五个关键建模决策

### 1. 床位是最小单位，不是房间

上下铺是两个位置；事故追溯要精确到铺位；空床数要准。
房间级建模在这三件事上都做不到。

**代价**：夫妻房的一张双人床要建成 2 个 `Bed` 行。
这看着别扭，但保住了「一个铺位同时最多一人」这条不变量 ——
一旦为夫妻房破例，所有依赖这条不变量的查询都要加特判。

### 2. 入住是带时间区间的记录

见上面 [入住](#入住)。

**代价**：查「当前在住」要带条件，不能直接 `SELECT * FROM occupancy`。
`services/space.ts` 里统一封装了这个条件，不要在业务代码里手写。

**换来的**：事故追溯、密接排查、住宿费按人天算、
「三个月前这张床住的谁」—— 这些用覆盖式更新的表根本写不出来。

### 3. 三个「人数」是三个字段

| | 字段 | 例：一间标称四人、批准住三人、屋里有四张床的房 |
|---|---|---|
| 标称规格 | `RoomType.defaultCapacity` | 4 |
| **核定人数** | `Room.capacity` | **3** |
| 物理床位 | `Bed` 行数 | 4（其中 1 张 `status = DISABLED`） |

**空床数永远用 `Room.capacity − 在住人数` 算，不用 `Bed` 行数。**

降标时多余的床标记为 `DISABLED` 而不是删除：
- 历史 `Occupancy` 还引用着这些床，删了会断链
- 将来恢复标准配置时改回来就行，不用重建

### 4. 投诉与违规分表

见上面 [投诉](#投诉)。一句话：**投诉是一面之词，违规是已查实。**
合表等于默认「有人说了就是真的」。

### 5. 字典软删除

所有字典表（部门、房型、违规类型……）删除时只置 `active = false`。

原因很简单：一个部门被撤销了，但历史入住记录、违规记录、花名册导出里还引用着它。
硬删之后这些记录会变成孤儿，报表直接崩。

软删的字典项不再出现在新建表单的下拉里，但历史数据仍能正确显示。

---

## 切换到 PostgreSQL

`schema.prisma` 是按 **PG 兼容写法**写的（没有用 SQLite 独有特性），切换只要三步：

```prisma
datasource db {
  provider = "postgresql"          // 原为 sqlite
  url      = env("DATABASE_URL")
}
```

```bash
DATABASE_URL="postgresql://user:pass@host:5432/dorm"
npx prisma db push
npm run db:seed        # 或者从 SQLite 导数据过来
```

**什么时候该换**：SQLite 单文件、单写入者，几百人同时在线时写操作会排队；
也没有主从复制。演示和几十人的小园区够用，真上生产建议直接上 PG。

**导数据**：Prisma 没有内置跨库迁移。实际做法是写个脚本，
用两个 PrismaClient 分别连旧库和新库，按表依赖顺序读出来再写进去 ——
字典 → 空间 → 人员 → 入住 → 运营。
