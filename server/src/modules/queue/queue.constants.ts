/**
 * 异步队列常量（模块 5）
 *
 * 规格依据：
 * - PRD-002 R6：双方 completed 后**异步**生成报告（队列），正常 ≤10 秒，失败自动重试
 * - 边界总表 D1：生成失败重试 3 次，末次失败转人工工单（job_task）
 * - docs/adr/ADR-005.md 决策 4：报告生成走 Redis + BullMQ（架构 A-6），
 *   过期扫描用 BullMQ 定时任务（不引入 @nestjs/schedule）
 */

/** 报告生成队列名（BullMQ key 前缀见 QUEUE_KEY_PREFIX，与业务键隔离） */
export const REPORT_GENERATE_QUEUE = 'report-generate';

/** 邀请过期扫描队列名（定时任务，每小时整点） */
export const INVITE_EXPIRE_QUEUE = 'invite-expire';

/**
 * BullMQ 键前缀
 * RedisService 的业务键前缀是 `zhiban:`，此处再叠一层 `bull`，
 * 使队列键落在 `zhiban:bull:*`，运维 `KEYS zhiban:cfg:*` 之类的排查不会被队列键干扰。
 */
export const QUEUE_KEY_PREFIX = 'bull';

/** job_task.type 取值（与 docs/schema.sql `job_task.type` 注释一致，下划线形式） */
export const JOB_TYPE_REPORT_GENERATE = 'report_generate';
export const JOB_TYPE_SHARE_IMAGE = 'share_image';
export const JOB_TYPE_INVITE_EXPIRE = 'invite_expire';

/**
 * 报告生成尝试次数
 * ⚠️ 边界总表 D1「失败重试 3 次」在库里的落点是 `report.retry_count`（注释「上限 3」），
 *    该列记的是**重试次数**而非尝试次数，故总尝试次数 = 首次 1 次 + 重试 3 次 = 4。
 */
export const REPORT_GENERATE_ATTEMPTS = 4;

/** 重试退避（指数退避起始值，毫秒）：3s → 6s → 12s，10 秒级内完成首轮，累计不超 30s */
export const REPORT_GENERATE_BACKOFF_MS = 3_000;

/** 报告生成 job 名（BullMQ job name，与 job_task.type 区分：前者是队列内任务名，后者是台账类型） */
export const REPORT_GENERATE_JOB_NAME = 'generate';

/**
 * 报告生成的最大重试次数（= 总尝试次数 - 首次）
 * 来源：`report.retry_count` 注释「上限 3」与边界总表 D1「失败重试 3 次」。
 */
export const REPORT_GENERATE_MAX_RETRY = REPORT_GENERATE_ATTEMPTS - 1;

/** 邀请过期扫描的 job 名（定时任务每次派发的任务名） */
export const INVITE_EXPIRE_JOB_NAME = 'scan';

/** 过期扫描台账的业务键前缀（bizId = `scan:<ISO 小时>`，保证每轮一条台账、可追溯） */
export const INVITE_EXPIRE_BIZ_PREFIX = 'scan:';

/** 邀请过期扫描周期：每小时整点（ADR-005 决策 4） */
export const INVITE_EXPIRE_PATTERN = '0 * * * *';

/** 定时任务 ID（upsertJobScheduler 幂等键，重复注册只更新不叠加） */
export const INVITE_EXPIRE_SCHEDULER_ID = 'invite-expire-hourly';

/** 报告在 Redis 的缓存前缀（渲染结果缓存 300 秒，见 architecture.md §3.2） */
export const REPORT_CACHE_PREFIX = 'report:double:';

/** 报告缓存 TTL（秒） */
export const REPORT_CACHE_TTL_SEC = 300;
