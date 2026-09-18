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
| 第一道防线 | Nginx `allow <白名单>; deny all;`（后台域名整站 + `/api/admin/`） |
| 第二道防线 | 应用层 `AdminIpGuard` 校验 `ADMIN_ALLOWED_IPS`；**生产环境白名单为空 → 全部拒绝**（fail-closed）并在启动时打 error 日志 |
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

