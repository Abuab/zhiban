# 知伴 · 接口契约（api.md）

> 本文件随模块开发持续补充。**任何接口变更都必须同步本文件与两端类型定义。**
> 已收录：模块 2（微信登录与账号体系）
> 规格依据：`docs/constitution.md` 边界总表 A 域、PRD-005 §3、安全基线 §4

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
| 70001 | 429 | 操作过于频繁，请稍后再试 | 提示稍后重试（响应头带 `Retry-After`） |

### 0.3 限流规则（安全基线 §4「接口全局 rate limit」）

| 维度 | 作用范围 | 默认阈值 | 配置项 |
|---|---|---|---|
| IP | `POST /v1/auth/login` | 60 次 / 60 秒 | `RATE_LIMIT_LOGIN_IP_MAX` / `RATE_LIMIT_LOGIN_WINDOW_MS` |
| openid | `POST /v1/auth/login`（`code2session` 之后，同一 IP 下多账号也各自受限） | 20 次 / 60 秒 | `RATE_LIMIT_LOGIN_OPENID_MAX` |
| user | `PUT /v1/auth/profile`（昵称检测消耗微信内容安全配额，同时防刷审核池） | 10 次 / 60 秒 | 代码内声明 |

超限返回 `429` + `Retry-After: <秒>`；Redis 不可用时**放行并告警**（可用性优先）。

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
