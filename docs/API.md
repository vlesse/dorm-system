# 接口文档

REST + JSON。所有路径以 `/api` 开头。

演示环境的 base URL：`https://dm.free--china.com/api`
本地开发：`http://localhost:3101/api`

- [鉴权](#鉴权)
- [约定](#约定)
- [权限点](#权限点)
- [认证与用户](#认证与用户)
- [配置与字典](#配置与字典)
- [空间](#空间)
- [人员与关系](#人员与关系)
- [床位分配](#床位分配)
- [日常运营](#日常运营)
- [投诉](#投诉)
- [报表](#报表)
- [批量导入](#批量导入)
- [集成与通知](#集成与通知)
- [员工自助端](#员工自助端)
- [枚举值](#枚举值)

---

## 鉴权

除白名单外所有接口都要带：

```
Authorization: Bearer <token>
```

**白名单**（不需要登录）：

```
GET  /api/health
POST /api/auth/login
GET  /api/auth/methods
GET  /api/auth/sso/:provider
POST /api/self/otp/request
POST /api/self/otp/verify
GET  /api/self/sso/:provider
```

### 两种 token

| kind | 来自 | 能访问 |
|---|---|---|
| `USER` | `POST /api/auth/login` | 全部 `/api/*`，受权限点和楼栋范围约束 |
| `PERSON` | `POST /api/self/otp/verify` | **只有 `/api/self/*`**，其余一律 403 |

这个隔离在全局钩子里做，不是每个路由自己判断的。

### 登录

```http
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "dorm@2026" }
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 5, "username": "warden.a", "name": "A栋宿管",
    "role": "WARDEN", "roleName": "楼栋宿管",
    "perms": ["space:read", "person:read", "allocation:*", "workorder:*", "..."],
    "buildings": [1],
    "locale": "zh",
    "mustChangePassword": false
  }
}
```

`buildings` 为空数组表示**不限楼栋**；有值则该用户只能看到这些楼栋的数据。

---

## 约定

### 状态码

| 码 | 含义 |
|---|---|
| `200` | 成功 |
| `400` | 参数错误，或**排宿硬约束不通过**（`force` 也过不去） |
| `401` | 未登录 / token 过期，`code: UNAUTHENTICATED` |
| `403` | 权限不足；或员工 token 访问管理端，`code: NOT_STAFF` |
| `404` | 资源不存在 |
| **`409`** | **排宿软约束提醒** —— 带上 `force: true` 重发可继续 |
| `500` | 服务端错误 |

`400` 和 `409` 的区分是这套 API 的核心约定，前端据此决定是「直接报错」还是「弹确认框」。

### 错误响应

普通错误只有一个 `error` 字段，有些带辅助字段：

```json
{ "error": "该人员已有床位 A-107-2，请使用「调宿」", "currentBedId": 38 }
```

排宿校验失败时，明细在 `blockers`（硬约束）或 `warnings`（软约束）里：

```json
{ "error": "不满足硬性排宿规则", "blockers": [
  { "rule": "gender", "mode": "HARD", "ok": false, "message": "男女不同房：该房间为女生房" }
] }
```

鉴权失败额外带 `code`：`UNAUTHENTICATED`（401）、`NOT_STAFF`（403）。

### 分页

列表接口统一 `?page=1&pageSize=50`，返回：

```json
{ "rows": [...], "total": 2558, "page": 1, "pageSize": 50 }
```

### 楼栋数据范围

所有列表和统计接口都会按当前用户的楼栋范围过滤。
用 `warden.a`（只管 A 栋）和 `admin` 分别请求 `/api/dashboard`，返回的数字不同。

---

## 权限点

形式 `模块:动作`，支持通配 `*` 和 `模块:*`。

| 权限点 | 保护的操作 |
|---|---|
| `person:read` / `person:write` | 人员档案、关系 |
| `space:write` | 楼栋 / 楼层 / 房间属性 |
| `space:room` | 房间状态 |
| `space:capacity` | **调整核定人数（降标）** |
| `allocation:write` | 入住、调宿、退宿、夫妻房、加床、床位状态 |
| `workorder:write` | 报修工单 |
| `violation:create` / `violation:write` | 违规记录 |
| `visitor:write` | 访客 |
| `inspection:write` | 查寝与检查 |
| `item:write` | 物品发放归还 |
| `request:read` / `request:write` | 申请审批 |
| `complaint:read` / `complaint:write` | 投诉的查看与处理 |
| **`complaint:all`** | **看得到所有派发路径的投诉**。没有它只看得到 `routeTo=WARDEN` 的 |
| **`complaint:identity`** | **揭示匿名投诉人身份**。楼栋宿管没有。每次调用写审计 |
| `config:write` | 字典、阈值、排宿规则 |
| `integration:write` | **集成凭据（仅管理员）** |
| `user:read` / `user:write` | 账号与角色 |
| `audit:read` | 审计日志 |

`config:write` 和 `integration:write` 是分开的 —— 宿舍主管可以调阈值和规则，
但不能碰企业平台凭据。

**`complaint:all` 和 `complaint:identity` 刻意不给楼栋宿管**：
前者保证「投诉宿管本人」那类投诉不会落到被投诉人自己手上，
后者保证员工敢匿名投诉本楼的事。两条都在服务端收口，不是前端隐藏。

---

## 认证与用户

| | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 公开 | 存活探针 |
| GET | `/api/auth/methods` | 公开 | 可用登录方式（本地 + 已配置的 SSO） |
| POST | `/api/auth/login` | 公开 | 账号密码登录 |
| GET | `/api/auth/sso/:provider` | 公开 | 企业平台跳转（占位） |
| GET | `/api/auth/me` | 登录 | 当前用户 |
| POST | `/api/auth/change-password` | 登录 | `{ oldPassword, newPassword }` |
| POST | `/api/auth/logout` | 登录 | 记审计日志 |
| GET | `/api/users` | `user:read` | 账号列表 |
| POST | `/api/users` | `user:write` | 建账号 |
| PUT | `/api/users/:id` | `user:write` | 改账号（角色、楼栋范围、重置密码） |
| GET | `/api/audit-logs` | `audit:read` | 审计日志，可按操作人 / 动作 / 时间筛 |

---

## 配置与字典

### 一次性拿全部字典

```http
GET /api/meta
```

返回国籍、部门、职级、班次、宗教、承包商、房型、物品类型、违规类型、工单类别、
角色、用户、全部设置项、排宿规则默认值与元信息、以及所有枚举值。
前端启动时调一次，之后本地用。

### 字典 CRUD

`{dict}` 可取：`nationalities` `departments` `positionLevels` `shifts` `religions`
`contractors` `roomTypes` `itemTypes` `violationTypes` `workOrderCategories`
`complaintTypes` `roles`

| | 路径 | 权限 |
|---|---|---|
| GET | `/api/config/{dict}` | 登录 |
| POST | `/api/config/{dict}` | `config:write` |
| PUT | `/api/config/{dict}/:id` | `config:write` |
| DELETE | `/api/config/{dict}/:id` | `config:write` |

**删除是软删除** —— 字典项被历史记录引用着，硬删会断链。

### 设置项

| | 路径 | 权限 |
|---|---|---|
| GET | `/api/config/settings` | 登录 |
| PUT | `/api/config/settings/:key` | `config:write` |

排宿规则存在 `settings` 里，key 为 `rules`，值是 `{ 规则code: 'OFF'|'SOFT'|'HARD' }`。

### 设备与资产

| | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/devices` | 登录 | 摄像头 / 门禁，**为二期视频接入预留** |
| PUT | `/api/devices/:id` | `config:write` | |
| GET | `/api/assets` | 登录 | 房间资产（空调、家具） |
| PUT | `/api/assets/:id` | `config:write` | |

---

## 空间

| | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/space/tree` | 登录 | 园区 → 楼栋 → 楼层，带各级统计 |
| GET | `/api/space/floors/:id` | 登录 | 该层全部房间与床位（平面图用） |
| GET | `/api/space/floors/:id/summary` | 登录 | 该层汇总（入住率、国籍分布） |
| GET | `/api/space/rooms/:id` | 登录 | 房间详情：床位、在住人、资产、工单 |
| PUT | `/api/space/buildings/:id` | `space:write` | 楼栋属性与国籍/性别策略 |
| PUT | `/api/space/floors/:id` | `space:write` | 楼层策略（留 `null` 表示继承楼栋） |
| PUT | `/api/space/rooms/:id` | `space:write` | 房间属性 |
| **PUT** | **`/api/space/rooms/:id/capacity`** | `space:capacity` | **降标**，见下 |
| GET | `/api/space/rooms/:id/qrcode` | 登录 | 单间房门二维码 |
| GET | `/api/space/floors/:id/qrcodes` | 登录 | 整层批量打印 |

### 调整核定人数（降标）

```http
PUT /api/space/rooms/123/capacity
{ "capacity": 3, "deratedReason": "空调制冷量不足，主管批准按三人住" }
```

- 调低时，多余床位自动置 `status = DISABLED`（**不删除**，历史入住记录不断链）
- 调高时，被停用的床位按需恢复；不够就要先加床
- 若当前在住人数已超过新的核定人数，返回 `400`
- 记 `AuditLog`

---

## 人员与关系

| | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/persons` | `person:read` | 支持按姓名/工号搜索、国籍、部门、类型、住宿状态筛 |
| GET | `/api/persons/:id` | `person:read` | 档案 + 当前住宿 + 住宿履历 + 物品 + 违规 |
| POST | `/api/persons` | `person:write` | |
| PUT | `/api/persons/:id` | `person:write` | |
| GET | `/api/persons/:id/contacts` | `person:read` | **密接排查**，`?from&to&scope=room\|floor` |
| GET | `/api/relationships` | `person:read` | `?personId&type&verified` |
| POST | `/api/relationships` | `person:write` | 登记配偶 / 子女 |
| PUT | `/api/relationships/:id` | `person:write` | **核验**（`verified: true`） |
| DELETE | `/api/relationships/:id` | `person:write` | |
| GET | `/api/beds/:id/history` | `person:read` | 一张床住过的所有人 |

**只有已核验（`verified: true`）的配偶关系才能用于夫妻房分配。**

---

## 床位分配

| | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/allocation/candidates/:personId` | 登录 | **推荐床位**，按分排序，附各自触发的提醒 |
| GET | `/api/allocation/check` | 登录 | `?personId&bedId` 预校验，不写库 |
| POST | `/api/allocation/assign` | `allocation:write` | 入住 |
| POST | `/api/allocation/transfer` | `allocation:write` | 调宿 |
| POST | `/api/allocation/checkout` | `allocation:write` | 退宿 |
| POST | `/api/allocation/hold` | `allocation:write` | 挂起（休假保留床位） |
| POST | `/api/allocation/resume` | `allocation:write` | 恢复 |
| POST | `/api/allocation/assign-couple` | `allocation:write` | 夫妻房整户分配 |
| POST | `/api/allocation/extra-bed` | `allocation:write` | 加床 |
| PUT | `/api/beds/:id/status` | `allocation:write` | 床位状态（报修、停用） |

### 入住

```http
POST /api/allocation/assign
{ "personId": 101, "bedId": 2048, "note": "新入职", "force": false, "reserveOnly": false }
```

| 结果 | 含义 |
|---|---|
| `200` | 成功，返回新的 `Occupancy` |
| `400` + `blockers[]` | 硬约束不通过。**`force: true` 也不行** |
| `409` + `warnings[]` | 软约束提醒。带 `force: true` 重发即可继续 |

`reserveOnly: true` 表示预留（床位占住，人还没到）。

### 退宿

```http
POST /api/allocation/checkout
{ "personId": 101, "reason": "离职", "settleItems": true }
```

`settleItems: true` 会一并结算领用物品。**有未归还物品且未开启结算时返回 `400`**
并列出清单 —— 这是有意的拦截。

### 夫妻房

```http
POST /api/allocation/assign-couple
{ "personIdA": 101, "personIdB": 102, "roomId": 55 }
```

两人必须有**已核验的配偶关系**，房间必须是夫妻房型，且有两个可用铺位。

---

## 日常运营

### 工单

| | 路径 | 权限 |
|---|---|---|
| GET | `/api/workorders` | 登录 |
| POST | `/api/workorders` | `workorder:write` |
| PUT | `/api/workorders/:id` | `workorder:write` |

状态流转 `NEW → ASSIGNED → IN_PROGRESS → DONE → CLOSED`（可 `REJECTED`）。
类别标记为「影响住宿」的工单会**自动把房间置为维修中**，完成后转「待清洁」。

### 违规

| | 路径 | 权限 |
|---|---|---|
| GET | `/api/violations` | 登录 |
| POST | `/api/violations` | `violation:create` |
| PUT | `/api/violations/:id` | `violation:write` |
| GET | `/api/violations/ranking` | 登录 |

### 访客

`GET/POST /api/visitors`、`PUT /api/visitors/:id`（权限 `visitor:write`）。
**留宿访客需要走 `/api/requests` 审批。**

### 查寝与检查

| | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/inspections` | 登录 | |
| GET | `/api/inspections/:id` | 登录 | 含全部检查项 |
| POST | `/api/inspections` | `inspection:write` | **夜间查寝会自动生成该层在住人员点名清单** |
| PUT | `/api/inspections/:id` | `inspection:write` | |
| PUT | `/api/inspection-items/:id` | `inspection:write` | 逐项打分 / 标记在否 |

### 物品与押金

| | 路径 | 权限 |
|---|---|---|
| GET | `/api/issued-items` | 登录 |
| POST | `/api/issued-items` | `item:write` |
| PUT | `/api/issued-items/:id/return` | `item:write` |
| GET | `/api/deposits` | 登录 |

### 申请与公告

| | 路径 | 权限 |
|---|---|---|
| GET | `/api/requests` | `request:read` |
| POST | `/api/requests` | `request:write` |
| PUT | `/api/requests/:id` | `request:write` |
| GET | `/api/announcements` | 登录 |
| POST / PUT | `/api/announcements[/:id]` | `config:write` |

`PUT /api/requests/:id` 只改审批状态，**不执行动作** —— 批准之后仍需宿管去做实际分配。

---

## 投诉

投诉是**一面之词**，和 `Violation`（已查实）是两张表。认定成立才生成违规记录。

### 可见性

两层同时生效，都在服务端 `complaintScope()` 里收口：

| 条件 | 效果 |
|---|---|
| 没有 `complaint:all` | 只看得到 `routeTo = 'WARDEN'` 的投诉 |
| 有楼栋数据范围 | 只看得到目标房间 / 楼层在范围内的 |

不在范围内的投诉一律 `404`（不是 403）—— 连「它存在」都不透露。

### 匿名

**列表和详情接口永远不返回匿名投诉的 `complainant` 字段**，管理员也一样。
要看身份必须单独调 `/identity`，需要 `complaint:identity` 权限，且每次写 `AuditLog`。

响应里的 `canReveal` 只表示「前端要不要显示那个按钮」，不含任何身份信息。

| | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/complaints` | `complaint:read` | 列表。`?status&open&typeId&anonymous&buildingId&q&page&pageSize` |
| GET | `/api/complaints/stats` | `complaint:read` | 待办结 / 成立 / 不成立 / 匿名数 / **认定成立率** |
| GET | `/api/complaints/hot-rooms` | `complaint:read` | 被反复反映的房间，按**不同投诉人数**排 |
| GET | `/api/complaints/:id` | `complaint:read` | 详情 + 流水 + 关联投诉 + **被投诉房间在住名单** + 附件 |
| **GET** | **`/api/complaints/:id/identity`** | **`complaint:identity`** | **揭示匿名投诉人。写审计** |
| POST | `/api/complaints` | `complaint:write` | 宿管代录（当面口头投诉），一律实名 |
| PUT | `/api/complaints/:id/accept` | `complaint:write` | 受理，通知投诉人 |
| PUT | `/api/complaints/:id/investigate` | `complaint:write` | 转核实。备注默认**对投诉人不可见** |
| PUT | `/api/complaints/:id/resolve` | `complaint:write` | 认定，见下 |
| PUT | `/api/complaints/:id/close` | `complaint:write` | 归档 |
| POST | `/api/complaints/:id/comment` | `complaint:write` | 加备注，可选是否对投诉人可见 |
| PUT | `/api/complaints/:id/merge` | `complaint:write` | 合并到主单，原始记录不删 |
| GET | `/api/complaints/:id/attachments/:attId` | `complaint:read` | 附件。走鉴权，不放静态目录 |

### 认定

```http
PUT /api/complaints/123/resolve
{
  "outcome": "SUBSTANTIATED",
  "resolution": "当晚 23:30 现场核实属实，已当面提醒并记录违规。",
  "violationTypeId": 8,
  "violationPersonIds": [1024, 1088]
}
```

- `outcome` ∈ `SUBSTANTIATED` / `UNSUBSTANTIATED` / `DUPLICATE`
- **`resolution` 必填**，不成立也要写 —— 这段话原样发给投诉人。缺它返回 `400`
- `violationPersonIds` 留空 = 只在房间上记一条违规（找不到具体责任人时很常见）
- `violationTypeId` 留空 = 不生成违规，只把投诉标为成立
- 返回体带 `violationCodes[]`，列出实际开出的违规单号

### 员工自助端的投诉接口

| | 路径 | 说明 |
|---|---|---|
| GET | `/api/self/complaint-options` | 类别（含 `allowAnonymous`）+ 本楼各层房间 + 附件大小上限 |
| GET | `/api/self/complaints` | 我的投诉。**只返回标记为「对投诉人可见」的流水** |
| POST | `/api/self/complaints` | 提交，见下 |
| POST | `/api/self/complaints/:id/attachments` | 上传照片 / 录音（base64） |
| PUT | `/api/self/complaints/:id/withdraw` | 撤回（仅 NEW / ACCEPTED） |
| PUT | `/api/self/complaints/:id/rate` | 对处理结果打分 |

```http
POST /api/self/complaints
{
  "typeId": 1,
  "anonymous": true,
  "targetRoomId": 3457,
  "occurredFrom": "2026-09-10T23:10:00+08:00",
  "description": "隔壁凌晨两点还在唱歌"
}
```

| 校验 | 不通过时 |
|---|---|
| 类别 / 位置 / 发生时间缺一 | `400` |
| 发生时间在将来，或早于 `complaint.maxBacklogDays` | `400` |
| 该类别强制实名却传了 `anonymous: true` | `400`，并说明为什么要实名 |
| 24 小时内已达 `complaint.dailyLimit` 条 | **`429`** |
| 对同一房间处在 `complaint.targetCooldownHours` 冷却期 | **`429`**，返回上一条的编号 |

公共区域投诉传 `targetFloorId` + `targetArea` 代替 `targetRoomId`。

附件单个上限 4MB、最多 5 个；照片由前端先缩到 1280px；
服务端只接受白名单 MIME，**文件名由服务端生成**，不用前端传的名字拼路径。

---

## 报表

| | 路径 | 说明 |
|---|---|---|
| GET | `/api/dashboard` | 看板：床位总量 / 在住 / 空床 / 各楼入住率 / 国籍分布 |
| GET | `/api/alerts` | **15 类待办告警** |
| GET | `/api/roster` | 在住花名册（含家属），支持多维筛选 |
| GET | `/api/roster.csv` | 同上，CSV 导出，**带 UTF-8 BOM** |
| GET | `/api/evacuation` | 消防疏散清单，`?buildingId`，需协助者单独标出 |

**全部受楼栋数据范围约束。**

### 告警返回结构

一个对象，每个 key 是一类告警，值是明细数组；额外一个 `thresholds` 说明本次判定用的阈值。

```json
{
  "thresholds": { "warningDays": 30, "idWarnDays": 90, "staleDays": 3, "pointsThreshold": 10 },
  "resignedStillHoused": [
    { "occupancyId": 2415, "personId": 9, "employeeNo": "CN00009", "name": "邱明",
      "department": "电厂", "bedCode": "A-107-2", "roomCode": "A-107",
      "buildingName": "A栋 中方员工宿舍", "checkInAt": "2026-05-13T07:45:51.250Z", "daysHeld": 114 }
  ],
  "idExpiring": [ … ], "workOrderOverdue": [ … ]
}
```

17 个告警 key：

`resignedStillHoused` 离职未退宿 · `idExpiring` 证件即将到期 ·
`workOrderOverdue` 报修超时 · `overCapacity` 房间超住 ·
`coupleAnomalies` 夫妻房异常 · `dependentApart` 家属未同房 ·
`leaveDueSoon` 休假即将到期 · `violationOverLimit` 违规积分超限 ·
`visitorOverstay` 访客超期未离开 · `pendingRequests` 申请待审批 ·
`itemsNotReturned` 物品未归还 · `reservedStale` 已分配超期未入住 ·
`statusMismatch` 状态口径不一致 · `deratedMismatch` 降标与床位不一致 ·
`functionRoomOccupied` 功能房被占住 · `complaintOverdue` 投诉超时未处理 ·
`complaintHotRooms` 同一房间被多人反复反映

`GET /api/dashboard` 里会带上各类告警的**计数**，明细才需要调 `/api/alerts`。

---

## 批量导入

| | 路径 | 权限 |
|---|---|---|
| GET | `/api/import/schema` | 登录 |
| POST | `/api/import/:type/preview` | 对应类型的写权限 |
| POST | `/api/import/:type/commit` | 同上 |

`:type` ∈ `persons`（`person:write`）、`rooms`（`space:write`）、`occupancy`（`allocation:write`）

**`/api/import/schema`** 返回每种类型的字段定义 —— 模板表头、界面说明、后端校验**共用它**。

**preview 不写库**，逐行返回：

```json
{ "rows": [
  { "index": 1, "status": "CREATE", "errors": [], "warnings": [] },
  { "index": 2, "status": "UPDATE", "errors": [], "warnings": ["部门与原记录不同"] },
  { "index": 3, "status": "ERROR",  "errors": ["工号已存在于另一个人"], "warnings": [] }
] }
```

**commit** 支持 `onlyValid: true` 跳过错误行。
`occupancy` 类型的导入**会跑完整排宿规则引擎**，不会因为走导入通道就绕过校验。

---

## 集成与通知

| | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/integrations` | 登录 | 15 个平台及其能力、凭据字段、启用状态。**密钥读取时打码** |
| PUT | `/api/integrations/:id` | `integration:write` | 填凭据 / 启用停用 |
| POST | `/api/integrations/:id/test` | `integration:write` | 连通性测试 |
| GET | `/api/notifications` | 登录 | 站内信 |
| PUT | `/api/notifications/:id/read` | 登录 | |
| PUT | `/api/notifications/read-all` | 登录 | |
| POST | `/api/notifications/flush` | `integration:write` | 重发失败的通知 |
| POST | `/api/notifications/test` | `integration:write` | 按模板发一条测试 |
| GET | `/api/notification-templates` | 登录 | |
| PUT | `/api/notification-templates/:id` | `config:write` | 三语模板正文 |
| GET | `/api/sync-logs` | 登录 | 人员同步历史 |
| POST | `/api/sync/persons` | `integration:write` | **HR 系统人员同步入口**（占位实现） |

---

## 员工自助端

全部在 `/api/self/*`。只接受 `PERSON` token（`USER` token 也能访问，方便管理员调试）。

| | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/self/otp/request` | 公开 | `{ employeeNo }`，发验证码 |
| POST | `/api/self/otp/verify` | 公开 | `{ employeeNo, code }` → token |
| GET | `/api/self/sso/:provider` | 公开 | 企业平台扫码（占位） |
| GET | `/api/self/meta` | 自助 | 字典（三语）、工单类别、申请类型 |
| GET | `/api/self/profile` | 自助 | 住宿、室友、休假、证件到期 |
| GET | `/api/self/room/:code` | 自助 | **扫房门二维码进来的页面** |
| GET/POST | `/api/self/workorders` | 自助 | 我的报修 / 提交报修 |
| PUT | `/api/self/workorders/:id/rate` | 自助 | 完成后评价 |
| GET/POST | `/api/self/requests` | 自助 | 我的申请 / 提交申请 |
| PUT | `/api/self/requests/:id/cancel` | 自助 | 撤销 |
| GET | `/api/self/notifications` | 自助 | |
| PUT | `/api/self/notifications/:id/read` | 自助 | |
| GET | `/api/self/announcements` | 自助 | 按本人楼栋定向 |

**所有查询都强制加 `personId = token.sub`** —— 不接受前端传的 personId。

### 验证码

```http
POST /api/self/otp/request
{ "employeeNo": "CN00001" }
```

```json
{ "ok": true, "maskedPhone": "138****5678",
  "devFallback": true, "devCode": "482913" }
```

短信 / WhatsApp 渠道**未启用**时会直接回显验证码（`devFallback: true`），
方便演示和内网试用。配好真实渠道后这两个字段自动消失。

### 提交报修

```http
POST /api/self/workorders
{ "categoryId": 3, "title": "空调不制冷", "description": "…" }
```

**位置强制取本人当前住的房间**，`roomId` 传了也会被忽略 —— 员工填不错，也改不了别人的房间。

---

## 枚举值

全部可从 `GET /api/meta` 拿到。

| 枚举 | 取值 |
|---|---|
| 床位状态 | `FREE` `RESERVED` `OCCUPIED` `HELD` `MAINTENANCE` `LOCKED` `DISABLED` |
| 房间状态 | `AVAILABLE` `MAINTENANCE` `QUARANTINE` `LOCKED` `CLEANING` |
| 在职状态 | `ACTIVE` `ON_LEAVE` `BUSINESS_TRIP` `HOSPITALIZED` `RESIGNED` |
| 人员类型 | `EMPLOYEE` `DEPENDENT` `VISITOR` `INTERN` |
| 工单状态 | `NEW` `ASSIGNED` `IN_PROGRESS` `DONE` `CLOSED` `REJECTED` |
| 优先级 | `LOW` `NORMAL` `HIGH` `URGENT` |
| 严重度 | `LOW` `MEDIUM` `HIGH` `CRITICAL` |
| 申请类型 | `CHECKIN` `TRANSFER` `CHECKOUT` `COUPLE_ROOM` `VISITOR_OVERNIGHT` `EXTRA_BED` |
| 检查类型 | `NIGHT_ROLL_CALL` `HYGIENE` `SAFETY` |
| 关系类型 | `SPOUSE` `CHILD` `PARENT` `SIBLING` `OTHER` |
| 规则档位 | `OFF` `SOFT` `HARD` |
| 投诉状态 | `NEW` `ACCEPTED` `INVESTIGATING` `SUBSTANTIATED` `UNSUBSTANTIATED` `DUPLICATE` `WITHDRAWN` `CLOSED` |
| 投诉派发 | `WARDEN` `MANAGER` `EHS` `HR` |
