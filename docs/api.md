# 知伴 · 接口契约（api.md）

> 本文件随模块开发持续补充。**任何接口变更都必须同步本文件与两端类型定义。**
> 已收录：模块 2（微信登录与账号体系）、模块 8 切片（管理后台鉴权与站点配置）
> 规格依据：`docs/constitution.md` 边界总表 A 域、PRD-005 §3、安全基线 §4；`docs/adr/ADR-003.md`（后台鉴权与部署）

---

## 0. 通用约定

| 项 | 约定 |
|---|---|
| Base URL | `{VITE_API_BASE_URL}`，本地开发为 `http://localhost:3000/api` |
| 版本前缀 | 业务接口统一 `/v1/*`（服务端 URI 版本化）；健康检查无版本，保持 `/api/health` |
| 请求体格式 | `application/json`（UTF-8） |
| 鉴权 | 请求头 `Authorization: Bearer <token>` |
| 时间格式 | ISO 8601 字符串（UTC），如 `2026-09-18T06:12:33.000Z` |
| 字符编码 | 昵称按 Unicode 码点计数（emoji 记 1 个字符） |

### 0.1 统一响应体

成功与业务失败**都返回 HTTP 200/4xx + 同一结构**：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "traceId": "3f1c9a7e-...",
  "timestamp": 1789742128000
}
```

- `code = 0` 表示成功，`data` 为业务数据；非 0 表示失败，`data` 通常为 `null`
- `traceId` 请在报障时提供给客服，可快速定位服务端日志
- `message` 为可直接展示给用户的中文文案（前端无需自建文案表）

### 0.2 本模块相关错误码

| code | HTTP | message | 前端处理 |
|---|---|---|---|
| 10001 | 400 | 参数不合法 / 没有需要更新的字段 | 提示并修正入参 |
| 20001 | 401 | 请先登录 | 静默重登，失败则引导登录页 |
| 20002 | 401 | 登录已过期，请重新登录 | 同上 |
| 20003 | 403 | 需确认已满 18 周岁后使用 | 弹年龄确认 |
| 20004 | 403 | 请先同意隐私政策 | 弹隐私政策弹窗 |
| 20005 | 400 | 微信登录凭证已失效，请重试 | 直接重试（重新 `wx.login`） |
| 20006 | 400 | 微信服务暂时不可用，请稍后重试 | 重试 + 客服入口 |
| 20007 | 400 | 昵称不合法，请换一个 | 提示并保留原昵称 |
| 20008 | 403 | 账号已被停用，如有疑问请联系客服 | 提示，不重试 |
| 20009 | 401 | 登录状态已失效，请重新登录 | 静默重登，失败则引导登录页 |
| 70001 | 429 | 操作过于频繁，请稍后再试 | 提示稍后重试（IP 维度触发时响应头带 `Retry-After`） |

### 0.3 限流规则（安全基线 §4「接口全局 rate limit」）

| 维度 | 作用范围 | 默认阈值 | 配置项 |
|---|---|---|---|
| IP | `POST /v1/auth/login` | 60 次 / 60 秒 | `RATE_LIMIT_LOGIN_IP_MAX` / `RATE_LIMIT_LOGIN_WINDOW_MS` |
| openid | `POST /v1/auth/login`（`code2session` 之后，同一 IP 下多账号也各自受限） | 20 次 / 60 秒 | `RATE_LIMIT_LOGIN_OPENID_MAX` |
| user | `PUT /v1/auth/profile`（昵称检测消耗微信内容安全配额，同时防刷审核池） | 10 次 / 60 秒 | 代码内声明 |

超限返回 `429`（`code=70001`）；**IP 维度由守卫直接拒绝并带 `Retry-After: <秒>`，openid 维度在 `code2session` 之后判定，不带该响应头**。Redis 不可用时**放行并告警**（可用性优先）。

---

## 1. 微信登录

`POST /v1/auth/login`

小程序端流程：`wx.login` 取 code → 本接口换 openid → 服务端幂等建档 + 签发登录态。
规格依据：PRD-005 §3；边界总表 A1（openid 不变则账号跟随）、A3（多设备各自独立会话）。

**鉴权**：不需要（`@Public`）
**限流**：IP 60/分 + openid 20/分

### 请求

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `code` | string | 是 | `wx.login` 返回的临时凭证，5 分钟有效且一次性，长度 ≤ 128 |

```json
{ "code": "081Xy0Ga1AbCdE0..." }
```

### 响应 `data`

| 字段 | 类型 | 说明 |
|---|---|---|
| `token` | string | 自定义登录态（JWT，载荷含 `sub`=userId、`sid`=会话 id） |
| `tokenType` | `"Bearer"` | 固定值 |
| `expiresIn` | number | token 有效期（秒），默认 `JWT_EXPIRES_IN=30d` |
| `isNewUser` | boolean | 本次是否新建账号（可据此决定是否引导完善资料） |
| `user` | object | 用户资料，结构见 [§6](#6-用户资料结构) |

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresIn": 2592000,
    "isNewUser": true,
    "user": {
      "id": 1,
      "nickname": null,
      "nicknameStatus": "ok",
      "avatarUrl": null,
      "ageConfirmed": false,
      "privacyAgreed": false,
      "privacyPolicyVersion": null,
      "createdAt": "2026-09-18T06:12:33.000Z"
    }
  },
  "traceId": "3f1c9a7e-...",
  "timestamp": 1789742128000
}
```

### 主要失败

- `20005` code 无效/已使用 → 前端重新 `wx.login` 取新 code **重试一次**
- `20006` 微信接口不可用/超时 → 展示「稍后重试」+ 客服入口（**不出现死页**，A5）
- `20008` 账号被封禁/注销中 → 不提供重试
- `70001` 触发限流

---

## 2. 登录态续期

`POST /v1/auth/refresh`

**语义**：换发新 JWT，**沿用同一 `sid`**，不新建设备会话、不影响其他设备（A3 不互踢）。
用于小程序启动时延长登录态（A1：用户无感）。

**鉴权**：需要
**请求体**：无

### 响应 `data`

与 [§1](#1-微信登录) 相同，其中 `isNewUser` 恒为 `false`。

### 主要失败

- `20001` / `20002` / `20009` → 会话已失效：前端删除本地 token 并重新走登录（A1）
- `20008` 账号被封禁

---

## 3. 退出登录

`POST /v1/auth/logout`

**语义**：仅撤销**当前设备**的会话（Redis 会话记录删除），其他设备保持登录（A3）。
> 不采用「互踢」策略的理由：本产品存在「一台手机两人分别作答」的场景，互踢会导致另一方答题中断；且会话泄漏的风险由「单设备可撤销 + token 有效期 30 天 + Redis 会话校验」控制。

**鉴权**：需要
**请求体**：无

### 响应 `data`

```json
{ "revoked": true }
```

> 幂等：会话已失效时同样返回成功，前端本地登出不会被阻塞。

---

## 4. 查询本人资料

`GET /v1/auth/profile`

**鉴权**：需要

### 响应 `data`

见 [§6 用户资料结构](#6-用户资料结构)。

### 主要失败

- `20001` / `20002` / `20009` 会话失效
- `20008` 账号被封禁

---

## 5. 更新本人资料

`PUT /v1/auth/profile`

**鉴权**：需要
**限流**：user 维度 10 次 / 60 秒

### 请求

未传的字段一律不改（`undefined` 语义）；传入空字符串 = 清空昵称。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `nickname` | string | 否 | 2-20 个字符（Unicode 码点）；禁止控制字符与网址。走内容安全检测（A6） |
| `avatarUrl` | string | 否 | 必须为 https 链接，长度 ≤ 512 |
| `privacyAgreed` | boolean | 否 | 传 `true` 记录同意时间；缺省 `privacyPolicyVersion` 时服务端记当前版本 |
| `privacyPolicyVersion` | string | 否 | 用户看到的隐私政策版本号，长度 ≤ 16 |
| `ageConfirmed` | boolean | 否 | 传 `true` 记录已确认年满 18 周岁（隐私约束 2.4） |

```json
{ "nickname": "小红", "privacyAgreed": true, "privacyPolicyVersion": "v1.0" }
```

### 响应 `data`

| 字段 | 类型 | 说明 |
|---|---|---|
| `profile` | object | 更新后的用户资料 |
| `nicknameNotice` | string? | 昵称命中内容安全时的提示文案（不含违规词，可直接展示） |

```json
{
  "profile": { "...": "见 §6" },
  "nicknameNotice": "昵称已提交审核，审核通过后自动生效，期间仍展示原昵称"
}
```

### 昵称内容安全（A6）

处理顺序：**格式校验 → 本地敏感词兜底 → 微信内容安全检测 → 违规进审核池**。

- 违规昵称**不直接拒绝**：写入 `nickname_review` 审核池（`status=pending`），接口返回 `200`，`profile.nickname` 保持原值，`nicknameStatus = "pending_review"`
- 同一用户重复提交同一违规昵称会复用待审记录（防刷审核池）
- 微信内容安全**不可用**时降级为「本地词表通过即放行」并记录告警（可用性优先）
- 微信 `openid` 不会出现在任何响应中（接口最小化暴露）

### 主要失败

- `10001` 无任何字段需要更新（避免无意义写库）
- `20007` 昵称格式不合法（长度 2-20 / 含控制字符 / 含网址）
- `70001` 触发限流

---

## 6. 用户资料结构

```ts
interface UserProfile {
  id: number;                       // 用户编号
  nickname: string | null;          // 昵称；null = 未设置
  nicknameStatus: 'ok' | 'pending_review' | 'rejected';
  avatarUrl: string | null;
  ageConfirmed: boolean;            // 是否已确认年满 18 周岁
  privacyAgreed: boolean;           // 是否已同意隐私政策
  privacyPolicyVersion: string | null;
  createdAt: string;                // 注册时间（ISO 8601）
}
```

> **刻意不返回**：`openid` / `unionid` / `status` —— 会话由 token 承载，小程序端无需账号标识，减少敏感信息流转面（隐私约束 2.4）。

---

## 7. 登录态探针（联调/验收用）

`GET /v1/protected`

**用途**：验证「登录中间件是否生效」。未登录必须返回 `401`。
**鉴权**：需要

### 响应 `data`

```json
{ "userId": 1, "loggedIn": true }
```

### 未登录时

```json
{
  "code": 20001,
  "message": "请先登录",
  "data": null,
  "traceId": "...",
  "timestamp": 1789742128000
}
```

HTTP 状态码 `401`。会话已被登出/撤销时返回 `20009`（同为 `401`）。

---

## 8. 无版本接口（健康检查）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 进程存活（`VERSION_NEUTRAL`，不参与版本化） |
| GET | `/api/health/ready` | 依赖就绪：MySQL / Redis |

---

## 9. 站点公开配置

`GET /v1/config/public`

**用途**：小程序冷启动时在**登录前**取到品牌名等展示文案（品牌名要在登录页就显示）。
**鉴权**：**免鉴权**（`@Public()`），按 IP 限流防爬。
**规格依据**：`docs/adr/ADR-002.md`（新增站点配置域 `sys_config`，品牌名后台可配）。

### 响应 `data`

返回**嵌套结构**，由库中 `sys_config.config_key` 的点号分层（`brand.name` → `brand.name`）：

```json
{
  "brand": {
    "name": "知伴"
  }
}
```

### 下发规则（安全边界）

1. **只下发 `sys_config.is_public = 1` 的行**；该列默认 `0`（fail-closed），仅「面向全体用户的非敏感展示文案」可置 1。
2. 凭据、内部阈值类配置必须保持默认 `0`，不会出现在本接口。
3. `config_key` 须匹配 `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`；非法键跳过并在服务端告警，不进入响应体。

### 客户端约定

- **必须带兜底值**：接口失败或字段为空时用内置兜底品牌名渲染，**不弹错误提示、不阻塞隐私政策弹窗与登录流程**（边界总表 A5「不出现死页」）。空串同样收敛为兜底值。
- 品牌名不落本地存储（避免「本地缓存了旧品牌名」的一致性问题）。
- **生效范围仅限运行时展示文案**：登录页主标题、授权弹窗文案、隐私政策页标题、首页导航栏标题。
  `manifest.json` 的 `name`（编译期，且小程序对外名称由微信公众平台控制）与隐私政策正文里的运营主体名**不随本配置变化**，详见 ADR-002 §四。

### 变更生效

本接口**不加缓存**，运营改库后**下次冷启动即生效**，无需发版（ADR-002 决策 2：本表低频、行数极少，加缓存只会引入陈旧问题）。
写入界面已随模块 8 管理后台落地（见 §11），改配置会写 `audit_log`。

---

## 10. 管理后台鉴权（模块 8 切片）

**规格依据**：`docs/constitution.md` 第 728 行「管理后台：独立路径 + IP 白名单 + 账号密码 + 二次验证；后台接口与小程序接口分离鉴权」；`docs/adr/ADR-003.md`。

### 10.1 访问入口与访问控制

| 项 | 约定 |
|---|---|
| 后台域名 | `https://zhiban.arvine.cn`（与小程序 API 域名 `m.arvine.cn` 分离） |
| 接口 Base | `https://zhiban.arvine.cn/api/admin` |
| 前端产物 | 宿主 Nginx 静态托管（`/opt/zhiban/admin/dist`），SPA 由 `try_files` 回退 `index.html`（ADR-003 决策 5） |
| 路径为什么不是 `/admin/api/**` | 服务端已有全局前缀 `/api`，再叠 `/admin` 会变成 `/api/admin/**`；此表述已按 ADR-003 决策 1 修订 architecture.md §6 |
| 第一道防线 | Nginx `allow <白名单>; deny all;`（白名单文件 `/etc/nginx/conf.d/zhiban-admin-allow.inc`，不入库） |
| 第二道防线 | 应用层 `AdminIpGuard` 校验 `ADMIN_ALLOWED_IPS`；**生产环境白名单为空 → 全部拒绝**（fail-closed）并在启动时打 error 日志 |
| 白名单条目形式 | 支持**精确地址**与 **CIDR 网段**混用，如 `ADMIN_ALLOWED_IPS=203.0.113.7,10.0.0.0/8,2001:db8::/32`；非法条目按不匹配处理（fail-closed） |
| 白名单总开关 | `ADMIN_IP_WHITELIST_ENABLED`（默认开启；**仅显式 `false` 关闭**，写错值按开启算）。只作用于应用层，Nginx 需另行同步调整 |
| 客户端 IP 口径 | 只采信来源为回环的 `X-Forwarded-For` 且取**最后一段**，与限流守卫共用 `request-ip.util`（防 XFF 伪造绕过） |

> **`/api/admin/**` 不对外开放给非白名单 IP**：命中白名单外 IP 返回 `70002`，且写 `audit_log`（`admin_ip_denied`）。

### 10.2 鉴权模型（四维隔离）

后台令牌与小程序令牌**物理隔离**，任一层失效都不会互相冒充：

| 维度 | 后台 | 小程序 |
|---|---|---|
| 签名密钥 | `ADMIN_JWT_SECRET` | `JWT_SECRET` |
| 载荷类型 | `typ = "admin"`（守卫强断言） | `typ = "user"` |
| 会话存储 | Redis `admin_session:<sid>` | Redis `session:<sid>` |
| 守卫 | `AdminAuthGuard` | `AuthGuard` |

- 请求头：`Authorization: Bearer <token>`，有效期由 `ADMIN_JWT_EXPIRES_IN` 控制（默认 `8h`，与 Redis 会话同步滑动续期）。
- **未绑定动态码的管理员**：登录可成功，但只能访问带 `@AllowTotpUnbound()` 的接口（`logout` / `profile` / `totp/setup` / `totp/enable`）；其余后台接口返回 `20011`，前端据此强制跳转绑定页。
- **Redis 异常时后台守卫拒绝请求**（不做降级放行）——后台是高权限入口，可用性让位安全。

### 10.3 接口清单

| 方法 | 路径 | 鉴权 | 白名单 IP | 说明 |
|---|---|---|---|---|
| POST | `/api/admin/auth/login` | 免登录 | 必需 | 口令 + 动态码登录 |
| POST | `/api/admin/auth/logout` | 后台令牌 | 必需 | 撤销当前设备会话 |
| GET | `/api/admin/auth/profile` | 后台令牌 | 必需 | 当前管理员资料 |
| POST | `/api/admin/auth/totp/setup` | 后台令牌 | 必需 | 生成动态码密钥（返回 `otpauth` URL） |
| POST | `/api/admin/auth/totp/enable` | 后台令牌 | 必需 | 提交动态码完成绑定 |

#### POST `/api/admin/auth/login`

请求体：

```json
{ "username": "ops", "password": "********", "totpCode": "123456" }
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `username` | string | 是 | 1–64 字符 |
| `password` | string | 是 | 8–128 字符（真实强度由创建脚本约束） |
| `totpCode` | string | 已绑定动态码时**必填** | 6 位数字；未绑定时忽略 |

响应 `data`：

```json
{
  "token": "eyJ...",
  "expiresIn": 28800,
  "admin": { "id": 1, "username": "ops", "role": "super", "totpEnabled": false }
}
```

- `totpEnabled = false` 表示尚未绑定动态码，前端**必须**跳转绑定页，此时除绑定流程外的后台接口均返回 `20011`。
- 限流：按 IP `ADMIN_LOGIN_IP_MAX` 次 / `ADMIN_LOGIN_WINDOW_MS`（默认 10 次 / 5 分钟）。

#### POST `/api/admin/auth/logout`

无请求体。响应 `data`：`{ "revoked": true }`（会话不存在时亦返回 `true`，幂等）。

#### GET `/api/admin/auth/profile`

响应 `data`：

```json
{ "id": 1, "username": "ops", "role": "super", "totpEnabled": true, "lastLoginAt": "2026-09-19T02:10:00.000Z" }
```

#### POST `/api/admin/auth/totp/setup`

无请求体。每次调用**重新生成**密钥（旧未确认密钥作废，Redis 暂存 10 分钟，不落库）。

响应 `data`：

```json
{ "secret": "JBSWY3DPEHPK3PXP", "otpauthUrl": "otpauth://totp/zhiban-admin:ops?secret=...&issuer=zhiban-admin" }
```

前端用 `otpauthUrl` 渲染二维码（`secret` 用于手动录入）。重复调用会覆盖上一次未确认的密钥。

#### POST `/api/admin/auth/totp/enable`

请求体：`{ "code": "123456" }`（6 位数字）。

响应 `data`：`{ "totpEnabled": true }`。校验通过后密钥**才落库**（`admin_user.totp_secret`）。

### 10.4 本模块错误码

| code | HTTP | message | 前端处理 |
|---|---|---|---|
| 10001 | 400 | 参数不合法 | 提示并修正入参 |
| 10002 | 404 | 资源不存在 | 提示刷新列表 |
| 20001 | 401 | 请先登录 | 清 token 回登录页 |
| 20002 | 401 | 登录已过期，请重新登录 | 同上 |
| 20008 | 403 | 账号已被停用，如有疑问请联系客服 | 提示，清 token 回登录页，不重试 |
| 20009 | 401 | 登录状态已失效，请重新登录 | 清 token 回登录页 |
| 20010 | 401 | 账号或密码错误 | **统一文案防账号枚举**；就地表单提示，不跳转 |
| 20011 | 403 | 请先完成二次验证绑定 | 强制跳转绑定页 |
| 20012 | 401 | 二次验证码错误或已过期 | 仅清空动态码输入框，不退出登录 |
| 20013 | 400 | 请先获取二次验证密钥 | 提示并回到绑定流程第一步 |
| 20014 | 409 | 二次验证已绑定，如需重置请联系运维 | 提示，引导重新登录 |
| 70001 | 429 | 操作过于频繁，请稍后再试 | 提示稍后重试（响应头带 `Retry-After`） |
| 70002 | 403 | 当前网络环境不可访问 | 展示「当前网络不可访问后台」，**不要自动重试**（重试无意义） |

> 账号枚举防护：账号不存在时服务端仍执行等价耗时的口令比对（dummy hash），`20010` 文案对「账号不存在」与「口令错误」保持一致。

---

## 11. 管理后台 · 站点配置（模块 8 切片）

**用途**：编辑 `sys_config` 中的运行时文案（当前为品牌名 `brand.name`），变更经 `GET /api/v1/config/public` 下发到小程序，**零发版**。
**鉴权**：后台令牌 + **必须已绑定动态码**（本控制器所有接口均未标 `@AllowTotpUnbound()`）。
**能力边界**（ADR-003 决策 6）：**只读列表 + 编辑已有项，不支持新增 / 删除配置键**。键名被代码消费，新增无用键只是噪音，删键会让线上小程序丢配置。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/configs/groups` | 分组清单（后台左侧导航） |
| GET | `/api/admin/configs` | 配置分页列表 |
| PATCH | `/api/admin/configs/:configKey` | 编辑单个配置项 |

### 11.1 GET `/api/admin/configs/groups`

响应 `data`：分组名与条目数，按分组名升序。

```json
[ { "group": "brand", "count": 2 }, { "group": "site", "count": 3 } ]
```

### 11.2 GET `/api/admin/configs`

查询参数：

| 参数 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `group` | string | 否 | 分组筛选，≤32 字符；不传返回全部分组 |
| `page` | number | 否 | ≥1，默认 1 |
| `pageSize` | number | 否 | 1–100，默认 20 |

响应 `data`（按 `configGroup` → `configKey` 升序）：

```json
{
  "items": [
    {
      "id": 1,
      "configKey": "brand.name",
      "configValue": "知伴",
      "configGroup": "brand",
      "valueType": "string",
      "isPublic": 1,
      "description": "小程序展示的品牌名",
      "updatedBy": 1,
      "updatedAt": "2026-09-19T02:10:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

- `valueType` ∈ `string` / `number` / `boolean` / `json`，决定 `configValue` 的写入校验规则（见 11.3）。
- `isPublic = 1` 才会经 §9 的公开接口下发；该列**默认 0**（fail-closed）。

### 11.3 PATCH `/api/admin/configs/:configKey`

请求体（三项**均可选**，至少提供一项；三项都传即为全量更新）：

```json
{ "configValue": "知伴", "isPublic": 1, "description": "小程序展示的品牌名" }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `configValue` | string | ≤4096 字符，按该键的 `valueType` 校验：`number` 必须为数字、`boolean` 归一为 `"true"`/`"false"`、`json` 必须能被 `JSON.parse` |
| `isPublic` | number | 只能 `0` 或 `1` |
| `description` | string | ≤256 字符 |

响应 `data`：更新后的配置项（结构同 11.2 的单项）。

失败场景：

| 场景 | code | 说明 |
|---|---|---|
| `:configKey` 不存在 | 10002 | 从接口层杜绝新增配置键 |
| 内容与库中完全一致 | 10001 | 提示「配置内容没有变化」；**不写审计**，避免反复点保存刷满日志 |
| `configValue` 不符合 `valueType` | 10001 | 例如向 `number` 键写入 `abc` |

### 11.4 审计留痕

每次**实际生效**的编辑写一条 `audit_log`：

| 字段 | 值 |
|---|---|
| `actor_type` / `actor_id` | `admin` / 操作管理员 id |
| `action` | `config_update` |
| `target_type` / `target_id` | `sys_config` / `config_key` |
| `detail_json` | `{ "before": {...}, "after": {...} }`（值 / isPublic / description） |
| `ip` / `user_agent` | 真实客户端 IP（与限流、白名单同口径）/ UA（截断至 256 字符） |

后台其余动作同样留痕：`admin_login`、`admin_login_failed`、`admin_logout`、`admin_totp_enabled`、`admin_ip_denied`。

### 11.5 变更生效

改完即生效（本接口链路**不加缓存**）：小程序下次冷启动 `GET /api/v1/config/public` 取到新值，无需重启服务、无需发版。

---

## 12. 单人测评（模块 4）

**用途**：一个人从头到尾完成一份量表并看到简版报告（prompt.md 模块 4 完成标准）。
**鉴权**：全部需要登录态；服务端逐接口校验「答题卷属于本人」，非本人访问与「答题卷不存在」**返回同一个错误 `10002`（404）**，不区分二者（区分会形成「自增 id 探测哪些卷存在」的枚举 oracle）；越权尝试记服务端 warn 日志供告警（F4）。
**限流**：沿用全局默认阈值（按 openid 计数）；答题与保存草稿属高频交互，不单独收紧。
**路由顺序**：`current` 先于 `:id` 声明，否则会被当作 id 参数匹配。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/assessments` | 开始作答（已有草稿则续答 B1；交卷后再调即重测 B6） |
| GET | `/api/v1/assessments/current?scene=` | 续答入口摘要；无草稿返回 `data = null` |
| GET | `/api/v1/assessments/:id` | 答题页数据（状态 + 题目 + 卷首文案，一次拉齐） |
| PUT | `/api/v1/assessments/:id/draft` | 保存草稿（增量合并 + 乐观锁 A3 + 净化） |
| POST | `/api/v1/assessments/:id/submit` | 交卷（B5 锁定）→ 返回简版报告 |
| GET | `/api/v1/assessments/:id/report` | 读取简版报告（未交卷返回 `40005`） |
| POST | `/api/v1/assessments/:id/supplement` | 补答被跳过的敏感维度（B7 事后补答 / A-4） |

> `:id` = `answer_sheet.id`。
> 保存草稿用 **PUT 而非 PATCH**：微信小程序 `wx.request` 的 `method` 合法值不含 `PATCH`（ADR-004 决策 4）。

### 12.1 POST `/api/v1/assessments`

```json
{ "scene": "single" }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `scene` | string | 必填，`single`（婚前关系准备评估，76 题）或 `p16`（16 型人格图谱，24 题二选一）；`invite` 由模块 5 创建，不对外开放（fail-closed） |

响应 `data`（`AssessmentDetail`）：

```json
{
  "sheet": {
    "id": 1,
    "scene": "single",
    "status": "draft",
    "draftVersion": 0,
    "answeredCount": 0,
    "totalCount": 76,
    "progressPercent": 0,
    "answers": {},
    "skippedDimensions": [],
    "durationSec": null,
    "qualityFlag": null,
    "reportReady": false,
    "startedAt": "2026-09-19T02:10:00.000Z",
    "submittedAt": null
  },
  "paper": {
    "scaleCode": "SCALE-PRE",
    "scaleName": "婚前关系准备评估",
    "scaleVersionId": 1,
    "scaleVersion": "1.0",
    "itemCount": 76,
    "introText": "以下题目没有对错，请按你的真实想法作答。……",
    "baselineIntroText": "以下几题关于婚前事实确认，同样没有对错，请按你的真实想法作答。",
    "dimensions": [
      {
        "code": "FINANCE",
        "name": "财务观与婚俗财务",
        "orderNo": 1,
        "isSensitive": false,
        "isScored": true
      }
    ],
    "questions": [
      {
        "code": "Q1",
        "orderNo": 1,
        "type": "scale",
        "title": "……",
        "reverse": false,
        "isStyle": false,
        "isBaseline": false,
        "dimensionCode": "FINANCE",
        "options": null
      }
    ]
  }
}
```

- `introText` / `baselineIntroText`：卷首文案，来自 `scale_version`（ADR-004），**端上不得硬编码**。
- `questions[].options`：量表题为 `null`（固定 1-5）；`choice` / `binary` 题为 `{ key, label }[]`（二选一题为 `A` / `B` 两端点）。
- `questions[]` **不含** `ext_json` 的考察点（运营参考不外泄）。
- `totalCount` 为**需作答题数**：等于 `itemCount` 扣除被跳过维度的题数（无跳过时即 `itemCount`）。

### 12.2 GET `/api/v1/assessments/current?scene=single`

响应 `data`：无进行中的草稿时为 `null`；有则：

```json
{
  "id": 1,
  "scene": "single",
  "answeredCount": 32,
  "totalCount": 76,
  "progressPercent": 42,
  "startedAt": "2026-09-19T02:10:00.000Z"
}
```

进度由服务端按锁定版本的题目定义重算，**不采信客户端上报的计数**。

### 12.3 GET `/api/v1/assessments/:id`

响应 `data` 结构同 12.1。已交卷（`status = "submitted"`）的卷也返回，端上据 `reportReady` 决定「只读 / 跳报告」。

### 12.4 PUT `/api/v1/assessments/:id/draft`

```json
{ "draftVersion": 2, "answers": { "Q1": 5, "Q2": 3 }, "skippedDimensions": ["INTIMACY"] }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `draftVersion` | number | 必填，≥0；乐观锁，须回传最近一次读到的值 |
| `answers` | object | 可选，`{题号: 分值或选项键}`：量表题整数 1-5、二选一题 `"A"`/`"B"`、选择题命中选项 key |
| `skippedDimensions` | string[] | 可选，**只接受敏感维度编码**；非法编码直接 `10001` 拒绝（fail-closed） |

语义：**增量合并**——本次未出现的题号保留服务端原答案（适配弱网分批补传 B2）。
净化：未知题号、取值越界、属于被跳过维度的答案**一律丢弃**（丢弃只记题号，不记答案内容）。

响应 `data`（`SheetState`）：

```json
{
  "id": 1,
  "scene": "single",
  "status": "draft",
  "draftVersion": 3,
  "answeredCount": 2,
  "totalCount": 76,
  "progressPercent": 3,
  "answers": { "Q1": 5, "Q2": 3 },
  "skippedDimensions": [],
  "durationSec": null,
  "qualityFlag": null,
  "reportReady": false,
  "startedAt": "2026-09-19T02:10:00.000Z",
  "submittedAt": null
}
```

### 12.5 POST `/api/v1/assessments/:id/submit`

```json
{ "draftVersion": 3, "answers": { "Q1": 5 }, "skippedDimensions": [], "durationSec": 612 }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `durationSec` | number | 必填，0 – 86400；客户端上报的**实际作答时长**（不含中途退出的时间），仅用于低质量标记 |

一次性完成：完整性校验 → 计分 → 落库（`dimension_scores_json`）→ 返回简版报告。响应 `data` 见 12.6。

### 12.6 GET `/api/v1/assessments/:id/report`

响应 `data`（`AssessmentReport`）：

```json
{
  "sheetId": 1,
  "scene": "single",
  "scaleCode": "SCALE-PRE",
  "scaleName": "婚前关系准备评估",
  "scaleVersion": "1.0",
  "scaleVersionId": 1,
  "submittedAt": "2026-09-19T02:20:00.000Z",
  "dimensions": [
    { "code": "FINANCE", "name": "财务观与婚俗财务", "evaluated": true, "score": 62.5, "supplemented": false },
    { "code": "INTIMACY", "name": "亲密关系", "evaluated": false, "score": null, "supplemented": false }
  ],
  "blocks": [
    { "blockKey": "INTRO", "orderNo": 10, "text": "这是你的婚前关系准备评估结果……", "meetsMinChars": true, "missingKeys": [] },
    { "blockKey": "FINANCE", "orderNo": 20, "text": "你在钱财透明度与共同决策上的取向比较清晰。", "meetsMinChars": true, "missingKeys": [] }
  ],
  "lockedHint": "邀请对方一起完成同一份量表，就能解锁双人对比报告：……",
  "baselineNotice": null,
  "lowQualityNotice": null,
  "quality": { "isLowQuality": false, "reasons": [], "durationSec": 612 },
  "disclaimer": "本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。",
  "p16": null
}
```

关键口径：

| 字段 | 说明 |
|---|---|
| `dimensions[].score` | 维度分 0-100（`(均分 - 1) × 25`，保留 1 位小数） |
| `dimensions[].evaluated = false` | 用户在敏感维度同意页拒绝授权被跳过（B7）；此时 `score` **恒为 `null`，绝不写 0**（全选 1 分也恰好得 0 分，写 0 会把「拒绝授权」误读为「极端取向」，ADR-004 决策 2）；端上标注「未评估」 |
| `dimensions[].supplemented` | 事后补答过的维度，端上标记「补测」 |
| `blocks[].blockKey` | `INTRO`（开场）或**维度编码**（该维度的一句话点评，≤30 字、无昵称） |
| `blocks[].missingKeys` | 模板占位符未填充的键名（非空时会原样展示占位符，属运营模板问题） |
| `lockedHint` | 付费墙锁定占位文案（`block_key = LOCK_HINT`），**已从 `blocks` 中剥离**；只说明解锁后可获得的内容类别，不含内容本体 |
| `baselineNotice` | 底线题组任一题答 1-2 分时的中性核实提示（B9 / 规则 6）；未触发为 `null` |
| `lowQualityNotice` | 作答质量提示（B3/B4 / 规则 7）；未触发为 `null` |
| `disclaimer` | 页脚固定免责声明（规格 2.3），取自 `report_template.disclaimer` |
| `p16` | `scene = "p16"` 时为 `{ typeKey, typeName, dimensions: [{ dimensionCode, dimensionName, pole, aCount, bCount, isTie }] }`，同时 `dimensions` 为空数组；`scene = "single"` 时为 `null` |

- 报告读取时按其**锁定版本**重新装载题目与模板（`includeOffline: true`），题库改版不影响历史报告（B8）。
- 报告模板缺失时 **fail-closed**（`40005`）：缺页脚免责声明属合规问题，不返回残缺报告。

### 12.7 POST `/api/v1/assessments/:id/supplement`

```json
{ "answers": { "Q20": 4, "Q21": 5 } }
```

- 只接受 `skippedDimensions` 中被跳过维度的题号；**夹带的已交卷题目答案一律丢弃**（B5 的唯一例外通道）。
- 必须**一次补齐**该维度的全部题目，否则 `30002`。
- 补答后重新计分，该维度转为已评估并标记 `supplemented = true`；响应 `data` 同 12.6。

### 12.8 错误码

| code | HTTP | 说明 | 端上处理 |
|---|---|---|---|
| 30001 | 404 | 量表没有生效版本，暂时无法开始作答 | 提示后重试 |
| 30002 | 400 | 还有题目未作答（业务等价 10001） | 跳转到第一道未答题 |
| 30003 | 400 | 已交卷，答案不可修改 | 直接跳报告页 |
| 30004 | 409 | 答案已在其他设备更新（A3 乐观锁） | 重新拉取服务端答案并提示 |
| 40005 | 400 | 报告未生成（未交卷 / 模板缺失） | 引导回到答题页继续作答 |
| 10002 | 404 | 答题卷不存在**或**不属于本人（两者合并，防 id 枚举） | 提示并返回首页 |
| 10001 | 400 | 参数不合法（如跳过非敏感维度） | 提示，不自动重试 |

### 12.9 关联规则（不在此文档重复，只给索引）

| 主题 | 真源 |
|---|---|
| 计分规则 1-8（反向计分、维度分、分歧、底线题、质量标记、16 型判定） | constitution.md 第 494-503 行 |
| 卷首文案 / 底线题组卷首 | constitution.md 第 293 行 / 第 408 行（落 `scale_version`，ADR-004） |
| 简版报告内容与文案红线（一句话点评 ≤30 字、无昵称、不分档） | 《价值感与内容标准》§一；ADR-004 决策 3 |
| 敏感维度跳过与「未评估」、事后补答 | 边界总表 B7；ADR-004 决策 2、决策 4 |
| 交卷后锁定、重测 | 边界总表 B5 / B6；ADR-004 决策 4 |

---

## 13. 双人邀请与对比报告（模块 5）

**用途**：发起方邀请伴侣用**同一份量表**作答，双方交卷后异步生成三层可见的对比报告（prompt.md 模块 5 完成标准）。
**鉴权**：全部需要登录态。**邀请码不是鉴权凭证**，只是「找到这条邀请」的入口；能否操作一律由服务端按参与方身份判定。
**越权**：非参与方与「邀请 / 报告不存在」返回**同一个** `10002`（404），不区分二者（ADR-005 决策 1 —— 区分会形成「按自增 id 探测哪些邀请真实存在」的枚举 oracle，泄露业务量）；越权尝试照常记 warn 日志供告警（F4）。
**限流**：`GET /invites/:code` 挂 `invite` 具名阈值（边界总表 C8 防枚举，默认 60s / 20 次）；创建另有服务端 Redis 冷却（10s，防「取消后立刻重建」刷邀请码，与接口限流互补）。
**路由顺序**：`GET /invites/mine` 必须先于 `GET /invites/:code` 声明，否则 `mine` 会被当作邀请码匹配。
**状态机**：`invite_created → invite_opened → consent_given → answering → completed → report_unlocked`；异常分支 `expired`（30 天未完成，可续期 1 次 × 7 天）/ `declined`（拒不同意，可换人 1 次）/ `cancelled`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/invites` | 创建邀请（发起方） |
| GET | `/api/v1/invites/mine` | 我的邀请列表（发起方 / 被邀请方两种视角） |
| GET | `/api/v1/invites/:code` | 打开邀请（绑定首个被邀请方 C1） |
| POST | `/api/v1/invites/:code/consent` | 知情同意（R8） |
| POST | `/api/v1/invites/:code/sheet` | 打开 / 续答邀请答卷 |
| PUT | `/api/v1/invites/:code/answers` | 保存草稿（增量合并 + 乐观锁） |
| POST | `/api/v1/invites/:code/answers` | 交卷 |
| POST | `/api/v1/invites/:code/reuse` | 复用历史单人答案（C3 / R7） |
| GET | `/api/v1/invites/:code/report` | 读取对比报告（按角色给 L1 / L2） |
| POST | `/api/v1/invites/:id/replace` | 换人重邀（C7，全流程限 1 次） |
| POST | `/api/v1/invites/:id/renew` | 续期 7 天（C4，限 1 次） |
| POST | `/api/v1/invites/:id/cancel` | 取消邀请 |
| POST | `/api/v1/invites/:id/remind` | 提醒对方作答（限 3 次） |
| POST | `/api/v1/reports/:id/share-image` | 生成 L3 分享版长图**素材** |

> `:code` = `invite.code`（32 位小写十六进制）；`:id` = `invite.id` / `report.id`（自增整数）。
> 保存草稿用 **PUT 而非 PATCH**：微信小程序 `wx.request` 的 `method` 合法值不含 `PATCH`（ADR-004 决策 4）。
> 分享素材接口的**路径**与 PRD-002 §7 一致，但**实现挂在邀请域**：L3 可见性判定依赖邀请的参与方关系与报告就绪状态，放在报告域会造成 invite ↔ report 双向依赖。

### 13.1 POST `/api/v1/invites`

发起方创建邀请；**创建即冻结发起方快照**（B8：报告基于邀请创建时锁定的答案，不受后续重测影响），故建邀请行与写快照在同一事务内完成。

```json
{ "scaleCode": "SCALE-PRE" }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `scaleCode` | string | 可选，≤32 字符；不传取婚前准备评估（`SCALE-PRE`）。保留该字段是为了 P2 引入第二套双人量表时无需改契约 |

前置（ADR-005 决策 7）：
1. 发起方已完成**同版本**单人测评（跨版本比对会让差值失真，B8）；
2. 当前没有进行中的邀请（PRD-002 §5 防囤积）——**终态不占额度**，「进行中」=`status IN (invite_created, invite_opened, consent_given, answering, completed)`。

响应 `data`（`InviteCreateResult`）：

```json
{
  "inviteId": 12,
  "code": "3f2a9c1e5b7d4086af13c9e2d5b74086",
  "status": "invite_created",
  "scaleVersionId": 1,
  "scaleVersion": "1.0",
  "expireAt": "2026-10-19T02:10:00.000Z",
  "createdAt": "2026-09-19T02:10:00.000Z",
  "replacedFromInviteId": null
}
```

- 服务端**不下发 H5 链接**：分享卡片 path 由端上拼接（`code` 已足够）。
- `expireAt` = 创建时间 + 30 天（C4）。

### 13.2 GET `/api/v1/invites/mine`

响应 `data`（`InviteListItem[]`，按 `inviteId` 倒序，上限 20 条）：

```json
[
  {
    "inviteId": 12,
    "code": "3f2a9c1e5b7d4086af13c9e2d5b74086",
    "role": "initiator",
    "status": "completed",
    "scaleVersion": "1.0",
    "counterpartNickname": "小满",
    "createdAt": "2026-09-19T02:10:00.000Z",
    "expireAt": "2026-10-19T02:10:00.000Z",
    "completedAt": "2026-09-19T03:40:00.000Z",
    "reportStatus": "ready",
    "reportId": 7
  }
]
```

| 字段 | 说明 |
|---|---|
| `role` | 当前用户在该邀请中的角色（同一邀请双方各看到一行） |
| `counterpartNickname` | 对方昵称（发起方视角=被邀请方，被邀请方视角=发起方）；未绑定 / 查不到为 `null` |
| `reportStatus` | `pending` / `ready` / `failed`；未生成过为 `null` |
| `reportId` | 仅 `reportStatus = "ready"` 时给（端上据此调 L3 素材接口），否则 `null` |

历史报告永久可回看（PRD-002 §5），列表不因过期 / 取消而移除。

### 13.3 GET `/api/v1/invites/:code`

打开邀请。**C1：邀请码绑定第一个完成授权登录的人**。

响应 `data`（`InviteView`，按访问者角色返回**结构性不同**的两种结构）：

发起方视角（`InviteInitiatorView`）：

```json
{
  "inviteId": 12,
  "code": "3f2a9c1e5b7d4086af13c9e2d5b74086",
  "role": "initiator",
  "status": "invite_opened",
  "scaleVersion": "1.0",
  "createdAt": "2026-09-19T02:10:00.000Z",
  "expireAt": "2026-10-19T02:10:00.000Z",
  "completedAt": null,
  "inviteeBound": true,
  "inviteeNickname": "小满",
  "remindRemaining": 3,
  "remindTemplateId": "9f3c1a2b7d8e4f5a0b6c1d2e3f4a5b6c",
  "renewRemaining": 1,
  "canReplace": false,
  "reportStatus": null
}
```

被邀请方视角（`InviteInviteeView`）：

```json
{
  "inviteId": 12,
  "code": "3f2a9c1e5b7d4086af13c9e2d5b74086",
  "role": "invitee",
  "status": "invite_opened",
  "scaleVersion": "1.0",
  "expireAt": "2026-10-19T02:10:00.000Z",
  "consentText": "你们的答案将共同生成一份关系分析；详细分析由发起人持有，你可见基础摘要。",
  "consentGiven": false,
  "remindTemplateId": "9f3c1a2b7d8e4f5a0b6c1d2e3f4a5b6c",
  "initiatorNickname": "阿泽",
  "reuse": { "allowed": true, "available": true, "sheetId": 31, "submittedAt": "2026-09-18T10:00:00.000Z" },
  "sheetId": null,
  "reportStatus": null
}
```

关键口径：

| 项 | 说明 |
|---|---|
| 角色分离 | 用判别联合（`role`）而非「一个大对象 + 可选字段」：让「被邀请方不可能拿到提醒 / 续期额度」「发起方不可能拿到同意书」由类型系统保证 |
| `consentText` | R8 原文，**服务端下发，端上不硬编码**（与留痕用同一常量，避免两处漂移） |
| `inviteeBound` / `inviteeNickname` | C1：未绑定时说明对方还没打开过；昵称为 `null` 时端上用兜底展示名（不回传硬编码文案） |
| 第三人打开 | 返回 `40002` +「该邀请已被接受」，**不泄露**发起方信息、是否有人答过、任何答题数据 |
| 发起方打开自己的链接 | 返回发起方视角，且**不占用**被邀请方名额 |
| `reuse.allowed` | 邀请自身的复用开关（`invite.reuse_allowed`）；`reuse.available` 才是「确实存在同版本历史答卷」 |
| `remindTemplateId` | 微信订阅消息模板 id（部署配置 `WX_SUBSCRIBE_TEMPLATE_INVITE`）：发起方用它发提醒，被邀请方在同意页用它调 `wx.requestSubscribeMessage` 订阅（**订阅授权必须发生在被提醒之前**）。未配置为 `null`，此时端上不弹订阅授权、提醒走「功能暂未开通」 |
| 过期 | `status = expired` 返回 `40003`（提示发起方可续期）；已取消等同不存在（`40001`） |

### 13.4 POST `/api/v1/invites/:code/consent`

```json
{ "agreed": true }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `agreed` | boolean | 必填；`false` = 拒绝同意 → `declined`（发起方可换人重邀 1 次，C7） |

- 仅被邀请方可确认（发起方调用 → `40004`）。
- `agreed = true`：`invite_opened → consent_given`；重复点击走**幂等返回**（多端 / 网络重试），其余状态一律拒绝。
- 响应 `data` 同 13.3 的**被邀请方视角**。

### 13.5 POST `/api/v1/invites/:code/sheet`

打开 / 续答邀请答卷；服务端**先建卷再渲染**，幂等，进入答题页前调用。
响应 `data` 为 `AssessmentDetail`，结构见 12.1（`sheet` + `paper`）。
差异点：`sheet.scene = "invite"`；答案与进度口径与单人一致（进度由服务端按锁定版本重算）。

### 13.6 PUT `/api/v1/invites/:code/answers`

请求体与语义**完全复用**单人测评的 `PUT /assessments/:id/draft`（见 12.4）：`{ draftVersion, answers, skippedDimensions }`；
增量合并、净化丢弃、乐观锁 `30004` 全部同源（共用同一套实现）。

- 首次保存草稿即推进 `consent_given → answering`（判定放在保存**之后**，避免「打开答题页但一题没答」就把状态推走）。
- 响应 `data`（`SheetState`）结构见 12.4。

### 13.7 POST `/api/v1/invites/:code/answers`

请求体与语义复用单人测评的 `POST /assessments/:id/submit`（见 12.5）：`{ draftVersion, answers, skippedDimensions, durationSec }`。

服务端一次性完成：完整性校验 → 计分 → 落库 → **冻结被邀请方快照**（标注 `is_reuse = 0`）→ `invite → completed` → 双方快照齐备则入队生成报告。

响应 `data`（`InviteProgressAck`）：

```json
{
  "inviteId": 12,
  "status": "completed",
  "reportStatus": "pending",
  "bothCompleted": true
}
```

| 字段 | 说明 |
|---|---|
| `reportStatus` | 报告状态；双方未齐备时为 `null` |
| `bothCompleted` | 双方快照是否齐备（`false` = 还在等对方） |

> 端上据 `reportStatus` 轮询 `GET /invites/:code/report`（R6），**无需额外通知接口**。

### 13.8 POST `/api/v1/invites/:code/reuse`

复用历史单人答案（C3 / R7），无请求体。

语义裁决：复用 = **以历史答案作为本次双人作答并直接完成**（等同交卷），依据是 R7「复用答案时，快照标注复用，**报告正常生成**」。需本人显式确认（本接口即确认动作），**不提供「替对方决定」的路径**。

响应 `data` 同 13.7（`InviteProgressAck`）。

### 13.9 GET `/api/v1/invites/:code/report`

按访问者角色返回 L1（发起方）/ L2（被邀请方）；报告未就绪时返回 pending / failed 供轮询。
裁剪发生在**服务端渲染之前**（不是前端过滤）：L2 的渲染上下文里根本没有分值 / 差值，即便模板误写占位符也渲染不出内容（双保险）。

报告生成中 / 失败（`DoubleReportPendingView`）：

```json
{ "reportId": null, "level": "L1", "status": "pending", "message": "报告生成中，稍后下拉刷新即可查看" }
```

L1 完整版（`DoubleReportL1View`，发起方）：

```json
{
  "reportId": 7,
  "inviteId": 12,
  "level": "L1",
  "status": "ready",
  "scaleVersion": "1.0",
  "generatedAt": "2026-09-19T03:40:07.000Z",
  "selfNickname": "阿泽",
  "partnerNickname": "小满",
  "dimensions": [
    { "dimensionCode": "FINANCE", "dimensionName": "财务观与婚俗财务", "scoreA": 75, "scoreB": 50, "gap": 25, "level": "mid", "levelLabel": "待沟通" },
    { "dimensionCode": "HOUSING", "dimensionName": "房产与居住", "scoreA": 62.5, "scoreB": 60, "gap": 2.5, "level": "high", "levelLabel": "高共识" }
  ],
  "unevaluatedDimensions": [{ "dimensionCode": "INTIMACY", "dimensionName": "亲密与关系期待" }],
  "consensusCodes": ["HOUSING"],
  "pendingCodes": ["FINANCE"],
  "divergenceItems": [
    {
      "questionCode": "Q12",
      "questionTitle": "……",
      "dimensionCode": "FINANCE",
      "dimensionName": "财务观与婚俗财务",
      "kind": "scale_gap",
      "gap": 4,
      "scoreA": 5,
      "scoreB": 1,
      "optionLabelA": null,
      "optionLabelB": null
    }
  ],
  "consensusItems": [
    { "questionCode": "Q3", "questionTitle": "……", "optionKey": "A", "optionLabel": "都接受婚前协议" }
  ],
  "baselineNotice": null,
  "lowQualityNotice": null,
  "blocks": [
    { "blockKey": "INTRO", "orderNo": 10, "text": "……", "meetsMinChars": true, "missingKeys": [] },
    { "blockKey": "FINANCE", "orderNo": 100, "text": "在「财务观与婚俗财务」上，你 75 分，小满 50 分，相差 25 分，属于「待沟通」。……", "meetsMinChars": true, "missingKeys": [] }
  ],
  "disclaimer": "本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。"
}
```

L2 基础版（`DoubleReportL2View`，被邀请方）：

```json
{
  "reportId": 7,
  "inviteId": 12,
  "level": "L2",
  "status": "ready",
  "scaleVersion": "1.0",
  "generatedAt": "2026-09-19T03:40:07.000Z",
  "selfNickname": "小满",
  "partnerNickname": "阿泽",
  "consensusItems": [
    { "questionCode": "Q3", "questionTitle": "……", "optionKey": "A", "optionLabel": "都接受婚前协议" }
  ],
  "baselineNotice": null,
  "blocks": [
    { "blockKey": "INTRO", "orderNo": 10, "text": "……", "meetsMinChars": true, "missingKeys": [] }
  ],
  "disclaimer": "本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。"
}
```

关键口径：

| 字段 | 说明 |
|---|---|
| `level` | `L1`（发起方）/ `L2`（被邀请方），由**服务端按角色**决定，端上不可指定 |
| `dimensions[].level` | 差值档位 `high` / `mid` / `low`，阈值取自 `scoring_rule.diff_threshold_high / mid`（默认 15 / 30，后台可配）；**边界归低一级**（`gap < 15` → `high`，`15 ≤ gap ≤ 30` → `mid`，`gap > 30` → `low`） |
| `levelLabel` | 中性分级名（高共识 / 待沟通 / 重点待沟通），取自 `scoring_rule.labels_json` |
| `unevaluatedDimensions` | 任一方在敏感维度拒绝授权 → 不参与比对，统一标注「未评估」（ADR-005 决策 7）；**绝不写 0 分**（全选 1 分也恰好 0 分，会误读为极端取向） |
| `divergenceItems` | 逐题分歧（R2）。`kind = "scale_gap"`：量表题分差 ≥3，按维度取分差降序**前 2**，给 `scoreA` / `scoreB` / `gap`；`kind = "option_differ"`：选择题选项不同，给 `optionLabelA` / `optionLabelB`，`scoreA` / `scoreB` 为 `null`、`gap` 固定为 0，`dimensionCode` 视题目是否归属维度而定 |
| `consensusItems` | 共识区（仅正向）：**选择题（`choice`）**中双方作答一致的题目。双方答案一致本身不构成信息泄露（R4 保护的是「对方的独立答案」），且它是 **L2 唯一的实质内容来源**与 L3 长图的素材来源 |
| `baselineNotice` | 底线题组触发时的中性核实提示（R5，**双方同一文案**）；未触发为 `null` |
| `lowQualityNotice` | 作答质量统一提示（C10，**不暴露是哪一方**）；未触发为 `null`。**L2 不含该字段**（避免被邀请方产生「被标记」感） |
| `blocks` | 模板渲染正文（改文案零发版）；L1 维度解读按差值档位取对应段落（每维度 300-500 字） |
| `disclaimer` | 页脚固定免责声明（规格 2.3），取自 `report_template.disclaimer` |

- 报告生成：双方 `completed` 后**异步**入队（BullMQ + Redis，目标 ≤10s，失败重试），worker 内按 `inviteId` 现查数据。
- **L1 逐报告冻结模板**（记 `template_version_id`），改版不影响历史报告；L2 / L3 只按版本取**当前生效模板**（ADR-005 决策 5）。
- 报告读取按锁定版本重装题目与模板（`includeOffline: true`），题库改版不影响历史报告（B8）。
- 结果按 `(inviteId, level)` 缓存 300s；L1 恒为发起方视角、L2 恒为被邀请方视角，不会串视角。

### 13.10 POST `/api/v1/invites/:id/replace`

换人重邀（C7）。仅当 `status = declined` 且该条**未派生过**新邀请时可调，全流程限 1 次；量表版本沿用原邀请（换人只换被邀请方，量表快照不应漂移，B8）。
响应 `data` 同 13.1（`InviteCreateResult`，其中 `replacedFromInviteId` = 被拒绝的原邀请 id）。

### 13.11 POST `/api/v1/invites/:id/renew`

续期（C4，限 1 次 × 7 天）。规格把续期写在 `expired` 分支下，故**未过期与已过期都可续期**。
- 新 `expireAt` = `max(当前时间, 原过期时间) + 7 天`（未过期时是「顺延」，不是「从现在起算」）。
- 过期后续期会把状态**复活到进行中**，目标按「对方是否已开始作答」推定（已建卷 → `answering`，仅打开过 → `invite_opened`，没打开过 → `invite_created`），对方已填答案与同意状态都不丢（答题卷独立于 invite 状态存在）。
- 响应 `data`（`InviteInitiatorView`）结构见 13.3。

### 13.12 POST `/api/v1/invites/:id/cancel`

取消邀请（§3 异常分支 `cancelled`）。仅进行中状态可取消；**已完成 / 已解锁不允许取消**（避免把已生成的报告孤儿化）。响应 `data` 同 13.3 发起方视角。

### 13.13 POST `/api/v1/invites/:id/remind`

提醒对方作答（PRD-002 §5，每邀请限 3 次）。
**ADR-005 决策 6：微信侧未送达不消耗次数**（对方未订阅模板消息 errcode 43101 是正常业务结果；若照扣次数，3 次机会可能一次都没真正送达）。故失败时抛错、**成功才计数**。

响应 `data`（`InviteRemindResult`）：

```json
{ "inviteId": 12, "remindCount": 1, "remindRemaining": 2, "remindAt": "2026-09-19T04:00:00.000Z" }
```

### 13.14 POST `/api/v1/reports/:id/share-image`

生成 L3 分享版长图素材（PRD-002 §7 / R3「分享版默认仅共识区」）。**仅发起方可生成**；被邀请方与非参与方一律按「报告不存在」响应（`10002`）。

```json
{ "selectedBlocks": ["Q3", "Q8"] }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `selectedBlocks` | string[] | 可选，≤200 项、每项 ≤16 字符；语义为**共识项题号**（`consensusItems[].questionCode`）。不传 = 默认共识区全量 |

响应 `data`（`DoubleReportL3Material`，ADR-005 决策 4：**服务端只下发素材，长图由小程序端 canvas 合成**——P1 无对象存储，服务端不落图片）：

```json
{
  "reportId": 7,
  "level": "L3",
  "title": "阿泽 与 小满 的共识清单",
  "nicknames": { "a": "阿泽", "b": "小满" },
  "date": "2026-09-19",
  "blocks": [
    { "blockKey": "SHARE_TITLE", "orderNo": 10, "text": "……", "meetsMinChars": true, "missingKeys": [] },
    { "blockKey": "SHARE_CONSENSUS", "orderNo": 20, "text": "……", "meetsMinChars": true, "missingKeys": [] },
    { "blockKey": "SHARE_ENDING", "orderNo": 30, "text": "……", "meetsMinChars": true, "missingKeys": [] }
  ],
  "watermark": "9f3c1a2b",
  "disclaimer": "本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。"
}
```

| 字段 | 说明 |
|---|---|
| `watermark` | `sha256("zhiban:share:" + user_id)` 前 8 位十六进制（D3 溯源）；端上**只负责绘制，不可伪造**，不承担权限判定职责 |
| `blocks` | 三个区块由 L3 模板固定；模板出现分数 / 差值 / 档位 / 维度名 / 待沟通清单 / 分歧清单 / 未评估清单 / 底线提示 / 质量提示任一占位符时**整块丢弃并告警**（fail-closed），故响应中不会出现负向内容 |
| `title` | 已过 P7 过滤，仅正向 |

### 13.15 错误码（模块 5）

| code | HTTP | 说明 | 端上处理 |
|---|---|---|---|
| 40001 | 404 | 邀请不存在（含邀请码格式不符、已取消） | 提示「邀请不存在或已失效」并返回 |
| 40002 | 400 | 该邀请已被接受（C1 非首个绑定者） | 提示「该邀请已被接受」 |
| 40003 | 400 | 邀请已过期（C4） | 提示发起方可续期 7 天 |
| 40004 | 400 | 当前状态不允许该操作（重复同意、非被邀请方作答、提醒 / 续期 / 换人次数已用完等） | 刷新邀请详情后重试 |
| 40005 | 400 | 报告未就绪（未交卷 / 生成中 / 模板缺失） | 引导回答题页或稍后刷新 |
| 40007 | 400 | 未完成同版本单人测评，无法发起邀请 | 跳单人测评页 |
| 40008 | 400 | 已有进行中的邀请（同时最多 1 个） | 跳转到该进行中的邀请 |
| 10002 | 404 | 邀请 / 报告不存在**或**不属于本人（两者合并，防枚举） | 提示并返回首页 |
| 30002 | 400 | 还有题目未作答 | 跳第一道未答题 |
| 30004 | 409 | 草稿已在其他设备更新（乐观锁） | 重新拉取服务端答案 |
| 70001 | 429 | 触发限流（邀请码查询 / 创建冷却） | 稍后重试，不自动重试 |
| 20006 | 400 | 提醒订阅消息发送失败（微信侧不可用） | 提示稍后再试；**本次不消耗提醒次数** |

> HTTP 状态码由 `BusinessException` 的 `ErrorStatus` 映射决定：仅 401 / 403 / 409（草稿冲突）/ 404（不存在类）/ 429 有显式映射，**其余业务错误码一律落 400**。端上请以响应体 `code` 为准做分支，不要依赖 HTTP 状态码区分业务原因。
> 状态机非法流转一律 `40004`；`40006`（报告越权）在当前设计下**不会被返回**——越权统一走 `10002`（ADR-005 决策 1）。

### 13.16 关联规则（不在此文档重复，只给索引）

| 主题 | 真源 |
|---|---|
| PRD-002 全文（状态机 / R1-R8 / 接口清单） | constitution.md 第 579-639 行 |
| 三层可见模型（L1 发起方 / L2 被邀请方 / L3 分享版） | 规范增补 v0.2 §3.1；constitution.md 第 216-230 行 |
| 差值阈值 15 / 30 与边界归低一级、分级名 | 计分规则（constitution.md 第 494-503 行）；`scoring_rule` 后台可配 |
| 完整版报告硬指标（每维度 300-500 字、分档） | 《价值感与内容标准》§一 |
| 越权统一 404、模板分档、换人链、队列与 canvas 长图 | docs/adr/ADR-005.md（决策 1-7） |
| 边界总表 C1 / C3 / C4 / C7 / C8 / C9 / C10、D1 / D2 / D3 / D5 / D6 | docs/constitution.md 边界总表 |
| 敏感维度「未评估」与底线题双向提示 | ADR-005 决策 7；R5 |

