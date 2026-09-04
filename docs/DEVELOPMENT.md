# 开发文档

- [环境准备](#环境准备)
- [目录结构](#目录结构)
- [启动与常用命令](#启动与常用命令)
- [代码约定](#代码约定)
- [后端](#后端)
- [前端](#前端)
- [常见开发任务](#常见开发任务)
- [调试](#调试)
- [已知的坑](#已知的坑)

---

## 环境准备

| | 版本 |
|---|---|
| Node.js | ≥ 20，推荐 22 LTS |
| npm | ≥ 10 |
| 数据库 | 默认 SQLite（零安装），可切 PostgreSQL |

```bash
git clone https://github.com/vlesse/dorm-system.git
cd dorm-system
npm run setup    # install + db push + seed，首次约 2 分钟
npm run dev      # api :3101 + web :5183
```

> npm 装依赖很慢的话，多半是镜像源对大 tarball（如 `@prisma/engines`、`esbuild`）
> 走 302 跳 CDN 跟不动。改回官方源：`npm config set registry https://registry.npmjs.org/`

---

## 目录结构

```
dorm-system/
├── package.json                 npm workspaces 根，dev / setup 脚本在这
├── server/
│   ├── prisma/
│   │   ├── schema.prisma        数据模型，全中文注释，改这里之后要 db:push
│   │   ├── seed.ts              业务模拟数据（楼栋 / 人员 / 工单 / 违规 …）
│   │   └── seed-platform.ts     账号 / 角色 / 集成占位 / 通知模板
│   └── src/
│       ├── index.ts             Fastify 入口 + 全局鉴权钩子 + 路由注册
│       ├── db.ts                PrismaClient 单例
│       ├── services/
│       │   ├── auth.ts          JWT / scrypt / 权限点 / 楼栋范围 / 审计
│       │   ├── rules.ts         17 条排宿规则 + scoreAssignment 打分
│       │   ├── space.ts         策略继承 / 序列化 / 摆床规格
│       │   └── notify.ts        通知中心 + ChannelAdapter
│       └── routes/
│           ├── auth.ts          登录、SSO 占位、用户管理
│           ├── config.ts        字典、设置、设备、资产
│           ├── space.ts         空间树、楼层、房间、降标、二维码
│           ├── persons.ts       人员、关系、床位历史、密接排查
│           ├── allocation.ts    推荐、校验、入住、调宿、退宿、夫妻房
│           ├── operations.ts    工单、违规、访客、检查、物品、申请、公告
│           ├── reports.ts       看板、告警、花名册、疏散清单
│           ├── integrations.ts  集成、通知、同步日志
│           ├── imports.ts       批量导入（模板 / 预检 / 写入）
│           └── self.ts          员工自助端全部接口
└── web/
    └── src/
        ├── main.tsx / App.tsx   路由与布局
        ├── api.ts               管理端 API 封装（token: dorm.token）
        ├── auth.tsx             登录态 Context
        ├── i18n.ts              管理端三语文案
        ├── pages/               管理端页面（16 个，含登录页）
        ├── components/          FloorPlan / BuildingTowers / AssignDrawer / …
        └── self/                员工自助端（独立 token / 路由 / 样式）
            ├── selfApi.ts       token: dorm.selfToken
            ├── selfI18n.ts      dict() / bed() helper
            └── self.css
```

---

## 启动与常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 同时起后端 3101 和前端 5183 |
| `npm run dev:api` / `npm run dev:web` | 只起一边 |
| `npm run db:push` | 把 `schema.prisma` 同步到数据库并重新生成 client |
| `npm run db:seed` | 清空业务数据并重新生成模拟数据 |
| `npm run db:reset -w server` | 强制重建库 + seed（**会丢数据**） |
| `npm run build -w web` | 构建前端到 `web/dist` |
| `npx tsc -p server/tsconfig.json` | 编译后端到 `server/dist` |
| `npx prisma studio -w server` | 用浏览器直接看/改数据库 |

**端口用 `API_PORT` 不是 `PORT`** —— 有些工具链会注入 `PORT` 抢占前端端口。

环境变量在 `server/.env`。**`npm run setup` 会自动从 `server/.env.example` 复制一份**，
已存在则不覆盖。

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | `file:./dorm.db` | Prisma 连接串，路径相对 `server/prisma/` |
| `API_PORT` | `3101` | |
| `API_HOST` | `0.0.0.0` | **生产必须设 `127.0.0.1`** |
| `JWT_SECRET` | 内置开发值 | **生产必须换掉** |

---

## 代码约定

- **注释写「为什么」，不写「是什么」。** `// 遍历房间` 这种没有价值；
  `// 用核定人数不用物理床位数，降标房的空床数才准` 才有。
- **注释用中文。** 使用方是中文团队。
- **业务口径不写死。** 任何「阈值 / 周期 / 分类 / 开关」都应该落到 `SettingItem` 或字典表里。
  写死一个数字之前先问：这个值半年后会不会变？会变就进配置。
- **权限守卫写在路由上，不写在业务函数里。** 每个写操作路由都要有 `requirePerm(...)`。
- **操作人取自 `req.auth`，永远不信前端传的 `operator` 字段。**
- 提交信息用中文，一句话说清做了什么。

---

## 后端

### 鉴权链路

```
请求
 └─ onRequest 钩子（index.ts）
     ├─ attachAuth(req)             解析 Bearer token → req.auth
     ├─ 白名单路径直接放行           /api/health, /api/auth/login, /api/self/otp/* …
     ├─ 无 req.auth → 401
     └─ PERSON token 访问非 /api/self/* → 403
 └─ 路由自身的 requirePerm('模块:动作')
 └─ buildingScope(req)              返回该用户可见的楼栋 id 数组，用于查询过滤
```

`requirePerm` 会**直接拒绝 PERSON token** —— 员工端接口一律用 `requireSelf`。

### 权限点

```ts
hasPermission(perms, 'space:write')
// perms 里有 '*' → 通过
// perms 里有 'space:*' → 通过
// perms 里有 'space:write' → 通过
```

角色的 `permissions` 字段存的是 JSON 数组字符串。

### 楼栋数据范围

```ts
const scope = buildingScope(req);   // number[] | null，null 表示不限（同步函数）
if (scope) where.buildingId = { in: scope };
```

**新写的任何列表 / 统计接口都要过一遍 `buildingScope`**，
否则 A 栋宿管会看到全园区数据 —— 这是最容易漏的一类 bug。

### 规则引擎

```ts
import { evaluateAssignment, splitChecks, scoreAssignment } from '../services/rules.js';

const checks = evaluateAssignment(person, roomContext, rules);
const { blockers, warnings } = splitChecks(checks);
if (blockers.length > 0) return reply.code(400).send({ error: '不满足硬性排宿规则', blockers });
if (warnings.length > 0 && !force) return reply.code(409).send({ error: '存在排宿提醒，确认后可继续', warnings });
```

约定：**`400` = 硬约束不通过（force 也过不去）**，**`409` = 软约束提醒（force 可继续）**。
前端按这两个码分别处理。

新增一条规则要改三处：
1. `rules.ts` 的 `DEFAULT_RULES` 加默认档位
2. `RULE_META` 加三语标题和说明（设置页自动渲染，不用改前端）
3. `evaluateAssignment()` 里加判断逻辑

### 空间策略继承

```ts
resolveNationality(room)   // room.nationalityId ?? floor.nationalityId ?? building.nationalityId
resolveGender(room)        // 同上
```

序列化房间统一用 `serializeRoom()`，它会带上「这个值是自己设的还是继承来的」。

### 接一个新的通知渠道

在 `services/notify.ts` 的 `ADAPTERS` 里加一项：

```ts
DINGTALK: {
  channel: 'DINGTALK',
  isReady: (c) => !!(c.appKey && c.appSecret && c.agentId),
  async send(msg, config) {
    const token = await getAccessToken(config);
    const res = await fetch('https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: config.agentId, userid_list: msg.toAddress, msg: { msgtype: 'text', text: { content: msg.body } } }),
    });
    if (!res.ok) throw new Error(`钉钉发送失败 ${res.status}`);
  },
},
```

`send()` 抛错即视为失败，错误信息会写进 `Notification.error`，在「通知」页可见。
**不要 catch 后静默返回** —— 那样排查「为什么没收到」就没线索了。

凭据字段在 `routes/integrations.ts` 的 `PROVIDER_FIELDS` 里声明，设置页会自动生成表单，
标了 `secret: true` 的字段读取时自动打码。

### 批量导入加一个类型

改 `routes/imports.ts` 的 `TYPES` 数组即可 —— 它是**模板表头、界面字段说明、
后端校验规则的唯一来源**，三者不会对不上。然后在 `validateRows()` / `applyRow()`
里加对应分支。

---

## 前端

### 两个应用，一个包

`/` 开头是管理端，`/m` 开头是员工自助端。两者**共用构建但不共用任何状态**：

| | 管理端 | 自助端 |
|---|---|---|
| API 封装 | `src/api.ts` | `src/self/selfApi.ts` |
| token 存储 key | `dorm.token` | `dorm.selfToken` |
| 文案 | `src/i18n.ts` | `src/self/selfI18n.ts` |
| 样式 | antd 默认 | `src/self/self.css`，移动优先 |

同一个浏览器里可以同时登录管理端和自助端，互不干扰 —— 演示的时候很有用。

### 字典项的三语渲染

后端返回的字典项是 `{ zh, id, en }` 三元组（`pick3()` 生成），前端用 `dict()` 取：

```tsx
import { dict } from './selfI18n';
<span>{dict(room.roomType, lang)}</span>
```

**不要在前端硬编码房型 / 部门名称**。新增一个部门不应该需要改前端代码。

床位标签同理 —— 由 `bedPosition` + `bedNo` 用 `bed()` 渲染，不是后端拼好的字符串。

### 布局注意

antd 的 `<App>` 包裹层默认没有高度，会让 `height: 100%` 的布局塌掉。
全局样式里已经加了 `.ant-app { height: 100% }`，动布局的时候别删。

栅格里想让某列吃掉剩余宽度，用 `<Col flex="1 1 0" style={{ minWidth: 0 }}>`，
**不要用 `flex="auto"`** —— 它的 flex-basis 是内容宽度，内容一多就会换行掉到下一排。

---

## 常见开发任务

<details>
<summary><b>加一个数据表字段</b></summary>

1. 改 `server/prisma/schema.prisma`，写清楚中文注释
2. `npm run db:push`（开发环境直接推，不生成 migration）
3. 需要的话在 `seed.ts` 里补上模拟数据
4. 后端序列化的地方带上（`services/space.ts` 的 `serializeRoom` 等）
5. 前端类型和界面

生产环境改 schema 前**先备份数据库**。
</details>

<details>
<summary><b>加一个管理端页面</b></summary>

1. `web/src/pages/Xxx.tsx`
2. `App.tsx` 里加路由和菜单项
3. 菜单项按权限点过滤 —— 没权限的角色不该看到入口
4. 后端路由记得 `requirePerm` + `buildingScope`
</details>

<details>
<summary><b>加一条告警</b></summary>

在 `routes/reports.ts` 的 `/api/alerts` 里加一段查询，返回统一结构：

```ts
{ code: 'CERT_EXPIRING', level: 'warning', count, items: [...] }
```

阈值走 `SettingItem`，不要写死。查询记得过 `buildingScope`。
</details>

<details>
<summary><b>改模拟数据的规模</b></summary>

`server/prisma/seed.ts` 顶部的常量：楼栋数、每栋层数、房型分布比例、人数、
国籍比例、配偶对数、故意制造的异常数据条数。改完 `npm run db:seed`。

seed 是**确定性的**（固定随机种子），同样的参数每次生成同样的数据，
方便对着截图排查问题。
</details>

---

## 调试

```bash
# 后端日志：dev 模式下 Fastify level=warn，需要详细日志改 index.ts
# 直接打接口（先拿 token）
TOKEN=$(curl -s -X POST localhost:3101/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"dorm@2026"}' | jq -r .token)

curl -s localhost:3101/api/dashboard -H "Authorization: Bearer $TOKEN" | jq

# 看数据库
npx prisma studio -w server
```

**验证权限有没有配漏**，最快的办法是用 `warden.a` 登录跑一遍：
它只该看到 A 栋，任何显示了别栋数据的地方都是漏了 `buildingScope`。

---

## 已知的坑

| | |
|---|---|
| **`prisma db push --force-reset` 可能被拒** | 直接删掉 `server/prisma/dev.db` 再 `db:push` |
| **Windows 下 heredoc 写中文文件容易断** | 用编辑器写，别用 shell heredoc |
| **`vite build` 吃内存超过 1G** | 小内存服务器上会 OOM，构建放本地做 |
| **改了 `JWT_SECRET` 后所有人被登出** | 预期行为，清 localStorage 重登 |
| **导入时错误行的计数** | ERROR 行只计 `failed`，不要同时算进 `skipped` |
| **房门二维码地址不对** | 反代场景下设置 `self.baseUrl`，别依赖 Host 头 |
