-- =============================================================
-- 《知伴》数据库建表 SQL v0.1
-- 依据：docs/constitution.md（数据模型要点见 PRD-002 §6 / PRD-005 §1）
-- 引擎：MySQL 8.0 / InnoDB / utf8mb4
-- 命名：字段与表名用英文，注释用中文
-- 阶段 0 裁决：P1 全免费 → order / entitlement / coupon 三组表建表保留但本版本不启用
-- =============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -------------------------------------------------------------
-- 一、账号与登录（边界总表 A 域）
-- -------------------------------------------------------------

DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `openid`          VARCHAR(64)     NOT NULL                COMMENT '微信 openid（账号唯一标识，换设备不变 A1）',
  `unionid`         VARCHAR(64)     DEFAULT NULL             COMMENT '微信 unionid（如有）',
  `nickname`        VARCHAR(64)     DEFAULT NULL             COMMENT '昵称，禁入敏感词（A6）',
  `nickname_status` VARCHAR(16)     NOT NULL DEFAULT 'ok'    COMMENT '昵称状态 ok / pending_review / rejected（A6 违规进人工审核池）',
  `avatar_url`      VARCHAR(512)    DEFAULT NULL             COMMENT '头像地址',
  `age_confirmed`   TINYINT(1)      NOT NULL DEFAULT 0       COMMENT '是否已确认 18+（E5 / 2.4）',
  `privacy_agreed_at` DATETIME      DEFAULT NULL             COMMENT '隐私政策同意时间（不同意仅可浏览首页）',
  `privacy_policy_version` VARCHAR(16) DEFAULT NULL          COMMENT '已同意的隐私政策版本号（规范增补 v0.3 §3.3 隐私条款同步修订）',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'active' COMMENT 'active / disabled / deleting',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_openid` (`openid`),
  KEY `idx_unionid` (`unionid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

DROP TABLE IF EXISTS `account_deletion_request`;
CREATE TABLE `account_deletion_request` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT UNSIGNED NOT NULL              COMMENT '申请人',
  `requested_at`  DATETIME        NOT NULL              COMMENT '申请时间',
  `effective_at`  DATETIME        NOT NULL              COMMENT '生效时间（申请 +7 天冷静期，F1）',
  `status`        VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT 'pending / done / cancelled',
  `done_at`       DATETIME        DEFAULT NULL          COMMENT '实际物理删除时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_effective` (`effective_at`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='注销申请（7 天冷静期后物理删除答题数据）';

DROP TABLE IF EXISTS `nickname_review`;
CREATE TABLE `nickname_review` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT UNSIGNED NOT NULL              COMMENT '提交人',
  `nickname`      VARCHAR(64)     NOT NULL              COMMENT '待审昵称原文（不覆盖 user.nickname）',
  `check_source`  VARCHAR(16)     NOT NULL              COMMENT 'wx（微信内容安全）/ local（本地词表兜底命中）',
  `check_result`  JSON            DEFAULT NULL          COMMENT '检测返回明细（含 suggest / label）',
  `status`        VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT 'pending / approved / rejected',
  `reviewer_id`   BIGINT UNSIGNED DEFAULT NULL          COMMENT 'admin_user.id',
  `reviewed_at`   DATETIME        DEFAULT NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status_created` (`status`, `created_at`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='昵称人工审核池（A6；审核动作在管理后台模块 8）';

DROP TABLE IF EXISTS `admin_user`;
CREATE TABLE `admin_user` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(64)     NOT NULL,
  `password_hash` VARCHAR(128)    NOT NULL              COMMENT 'bcrypt',
  `role`          VARCHAR(32)     NOT NULL DEFAULT 'operator' COMMENT 'super / operator',
  `totp_secret`   VARCHAR(64)     DEFAULT NULL          COMMENT '二次验证密钥（安全基线 §4）',
  `ip_whitelist`  VARCHAR(512)    DEFAULT NULL          COMMENT '逗号分隔 IP 白名单',
  `status`        VARCHAR(16)     NOT NULL DEFAULT 'active',
  `last_login_at` DATETIME        DEFAULT NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='后台管理员';

-- -------------------------------------------------------------
-- 二、量表域（配置化：量表/维度/题目，版本化 + 冻结不可变）
-- -------------------------------------------------------------

DROP TABLE IF EXISTS `scale`;
CREATE TABLE `scale` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`            VARCHAR(32)     NOT NULL              COMMENT '量表编码：SCALE-PRE / SCALE-16P',
  `name`            VARCHAR(64)     NOT NULL              COMMENT '量表名称',
  `description`     VARCHAR(512)    DEFAULT NULL,
  `latest_version_id` BIGINT UNSIGNED DEFAULT NULL        COMMENT '当前生效版本',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='量表主表';

DROP TABLE IF EXISTS `scale_version`;
CREATE TABLE `scale_version` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scale_id`        BIGINT UNSIGNED NOT NULL,
  `version`         VARCHAR(16)     NOT NULL              COMMENT '版本号，如 1.0',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'draft' COMMENT 'draft / frozen / deprecated',
  `item_count`      INT UNSIGNED    NOT NULL DEFAULT 0    COMMENT '题目总数（SCALE-PRE-1.0 = 76）',
  `frozen_at`       DATETIME        DEFAULT NULL          COMMENT '冻结时间；冻结后不可编辑（B8/G1）',
  `created_by`      BIGINT UNSIGNED DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scale_version` (`scale_id`, `version`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='量表版本（快照锚点，冻结后不可变）';

DROP TABLE IF EXISTS `scale_dimension`;
CREATE TABLE `scale_dimension` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scale_version_id` BIGINT UNSIGNED NOT NULL,
  `code`            VARCHAR(32)     NOT NULL              COMMENT '维度编码，如 FINANCE / HOUSING / INTIMACY',
  `name`            VARCHAR(64)     NOT NULL              COMMENT '维度名',
  `order_no`        INT UNSIGNED    NOT NULL DEFAULT 0,
  `is_sensitive`    TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '敏感维度（前置单独同意 B7）',
  `is_scored`       TINYINT(1)      NOT NULL DEFAULT 1    COMMENT '是否参与维度分（底线组为 0）',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_version_code` (`scale_version_id`, `code`),
  KEY `idx_order` (`scale_version_id`, `order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='量表维度';

DROP TABLE IF EXISTS `scale_question`;
CREATE TABLE `scale_question` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scale_version_id` BIGINT UNSIGNED NOT NULL,
  `dimension_id`    BIGINT UNSIGNED DEFAULT NULL          COMMENT '所属维度；底线题组可为空',
  `code`            VARCHAR(16)     NOT NULL              COMMENT '题号，如 Q1 / P1',
  `order_no`        INT UNSIGNED    NOT NULL              COMMENT '卷内顺序（答题进度以此排序）',
  `type`            VARCHAR(16)     NOT NULL              COMMENT 'scale 量表 / choice 选择 / binary A-B二选一',
  `title`           VARCHAR(512)    NOT NULL              COMMENT '题干',
  `reverse`         TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '反向题（6-原值）',
  `is_style`        TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '风格题：不计入维度分（Q27）',
  `is_baseline`     TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '底线题组（R5 / B9）',
  `options_json`    JSON            DEFAULT NULL          COMMENT '选择题选项；二选一存 A/B 端点文案',
  `ext_json`        JSON            DEFAULT NULL          COMMENT '考察点等扩展字段',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'on' COMMENT 'on / off（题目级开关 G1）',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_version_code` (`scale_version_id`, `code`),
  KEY `idx_version_order` (`scale_version_id`, `order_no`),
  KEY `idx_dimension` (`dimension_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='量表题目（含选项/反向/风格/底线标记）';

-- -------------------------------------------------------------
-- 三、答题与答案快照
-- -------------------------------------------------------------

DROP TABLE IF EXISTS `answer_sheet`;
CREATE TABLE `answer_sheet` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `scale_version_id` BIGINT UNSIGNED NOT NULL             COMMENT '作答锁定的量表版本（B6/B8）',
  `scene`           VARCHAR(16)     NOT NULL              COMMENT 'single 单人测评 / p16 十六型 / invite 双人邀请',
  `invite_id`       BIGINT UNSIGNED DEFAULT NULL          COMMENT 'scene=invite 时关联邀请',
  `answers_json`    JSON            DEFAULT NULL          COMMENT '答案：{题号: 分值或选项}',
  `draft_version`   INT UNSIGNED    NOT NULL DEFAULT 0    COMMENT '草稿版本号，防多端覆盖（A3）',
  `answered_count`  INT UNSIGNED    NOT NULL DEFAULT 0    COMMENT '已答题数（断点续答 B1）',
  `duration_sec`    INT UNSIGNED    DEFAULT NULL          COMMENT '总作答时长',
  `quality_flag`    VARCHAR(16)     DEFAULT NULL          COMMENT 'low 低质量（B3 时长过短 / B4 直线作答）',
  `dimension_scores_json` JSON      DEFAULT NULL          COMMENT '本卷维度分缓存',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'draft' COMMENT 'draft / submitted',
  `started_at`      DATETIME        DEFAULT NULL,
  `submitted_at`    DATETIME        DEFAULT NULL          COMMENT '交卷时间；交卷后锁定不可改（B5）',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_scene` (`user_id`, `scene`, `status`),
  KEY `idx_invite` (`invite_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='答题卷（含草稿与提交态）';

-- -------------------------------------------------------------
-- 四、双人邀请（PRD-002 状态机）
-- -------------------------------------------------------------

DROP TABLE IF EXISTS `invite`;
CREATE TABLE `invite` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`            VARCHAR(64)     NOT NULL              COMMENT '邀请码：128 位随机（C8）',
  `initiator_uid`   BIGINT UNSIGNED NOT NULL              COMMENT '发起方',
  `invitee_uid`     BIGINT UNSIGNED DEFAULT NULL          COMMENT '被邀请方 = 首个完成授权登录者（C1）',
  `scale_version_id` BIGINT UNSIGNED NOT NULL             COMMENT '邀请创建即锁定量表版本（B8）',
  `status`          VARCHAR(24)     NOT NULL DEFAULT 'invite_created'
                    COMMENT 'invite_created/invite_opened/consent_given/answering/completed/report_unlocked/expired/declined/cancelled',
  `amount`          DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT 'P1 免费=0；P2 恢复付费后为 8.00',
  `reuse_allowed`   TINYINT(1)      NOT NULL DEFAULT 1    COMMENT '是否允许复用历史答案（C3 / R7）',
  `renewed_count`   TINYINT UNSIGNED NOT NULL DEFAULT 0   COMMENT '续期次数，最多 1 次（C4）',
  `remind_count`    TINYINT UNSIGNED NOT NULL DEFAULT 0   COMMENT '提醒次数，最多 3 次（PRD-002 §5）',
  `remind_at`       DATETIME        DEFAULT NULL          COMMENT '最近提醒时间',
  `expire_at`       DATETIME        NOT NULL              COMMENT '过期时间（创建 +30 天）',
  `opened_at`       DATETIME        DEFAULT NULL,
  `completed_at`    DATETIME        DEFAULT NULL,
  `declined_at`     DATETIME        DEFAULT NULL,
  `cancelled_at`    DATETIME        DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`),
  KEY `idx_initiator_status` (`initiator_uid`, `status`),
  KEY `idx_invitee` (`invitee_uid`),
  KEY `idx_expire` (`expire_at`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='双人邀请（状态机主体）';

DROP TABLE IF EXISTS `answer_snapshot`;
CREATE TABLE `answer_snapshot` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invite_id`       BIGINT UNSIGNED NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL              COMMENT '作答人（发起方或邀请方）',
  `role`            VARCHAR(16)     NOT NULL              COMMENT 'initiator / invitee',
  `scale_version_id` BIGINT UNSIGNED NOT NULL             COMMENT '冗余存储，防跨版本比对失真',
  `answers_json`    JSON            NOT NULL              COMMENT '答案快照（不可变，B8）',
  `dimension_scores_json` JSON      NOT NULL              COMMENT '各维度分（0-100，公式 (均分-1)×25）',
  `quality_flag`    VARCHAR(16)     DEFAULT NULL          COMMENT 'low：低质量标记（C10 报告内统一提示，不单独暴露）',
  `baseline_triggered` TINYINT(1)   NOT NULL DEFAULT 0    COMMENT '底线题触发（任一题 1-2 分，R5/B9）',
  `is_reuse`        TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '是否复用历史单人答案（C3 / R7）',
  `duration_sec`    INT UNSIGNED    DEFAULT NULL,
  `completed_at`    DATETIME        DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invite_user` (`invite_id`, `user_id`),
  KEY `idx_invite` (`invite_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='答案快照（邀请创建时锁定量表版本）';

-- -------------------------------------------------------------
-- 五、对比报告与可见性审计
-- -------------------------------------------------------------

DROP TABLE IF EXISTS `report`;
CREATE TABLE `report` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invite_id`       BIGINT UNSIGNED NOT NULL,
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT 'pending / ready / failed（D1）',
  `retry_count`     TINYINT UNSIGNED NOT NULL DEFAULT 0   COMMENT '生成重试次数，上限 3',
  `dimension_scores_json` JSON      NOT NULL              COMMENT '双方各维度分',
  `diffs_json`      JSON            NOT NULL              COMMENT '各维度绝对差 + 分级（<15/15-30/>30，D6 阈值归低一级）',
  `flagged_items_json` JSON         NOT NULL              COMMENT '逐题分歧清单（同题差≥3 或选项不同，R2）',
  `consensus_json`  JSON            DEFAULT NULL          COMMENT '共识区（一致答案原文，给糖）',
  `baseline_triggered` TINYINT(1)   NOT NULL DEFAULT 0    COMMENT '是否输出底线核实提示（R5）',
  `template_version_id` BIGINT UNSIGNED DEFAULT NULL      COMMENT '渲染所用报告模板版本（历史报告用旧版渲染 D5）',
  `version`         VARCHAR(16)     NOT NULL DEFAULT '1.0' COMMENT '报告算法版本',
  `generated_at`    DATETIME        DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invite` (`invite_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='双人对比报告';

DROP TABLE IF EXISTS `visibility_log`;
CREATE TABLE `visibility_log` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_id`       BIGINT UNSIGNED NOT NULL,
  `viewer_uid`      BIGINT UNSIGNED NOT NULL,
  `level`           VARCHAR(8)      NOT NULL              COMMENT 'L1 完整版 / L2 基础版 / L3 分享版',
  `action`          VARCHAR(24)     NOT NULL DEFAULT 'view' COMMENT 'view / share_image_created / denied',
  `ip`              VARCHAR(64)     DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_report_viewer` (`report_id`, `viewer_uid`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报告可见性审计（R3/F4）';

-- -------------------------------------------------------------
-- 六、内容域：锦囊卡片流 + AI 专属卡
-- -------------------------------------------------------------

DROP TABLE IF EXISTS `topic`;
CREATE TABLE `topic` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`            VARCHAR(32)     NOT NULL              COMMENT '议题编码，如 caili / guanqian',
  `title`           VARCHAR(128)    NOT NULL              COMMENT '议题标题',
  `subtitle`        VARCHAR(256)    DEFAULT NULL,
  `mount_dimensions` JSON           DEFAULT NULL          COMMENT '挂载维度编码数组（待沟通区 → 议题包入口）',
  `order_no`        INT UNSIGNED    NOT NULL DEFAULT 0,
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'on' COMMENT 'on / off（内容下架开关 G3）',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='锦囊议题';

DROP TABLE IF EXISTS `topic_card`;
CREATE TABLE `topic_card` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `topic_id`        BIGINT UNSIGNED NOT NULL,
  `order_no`        INT UNSIGNED    NOT NULL              COMMENT '卡序（swiper 顺序）',
  `type`            VARCHAR(16)     NOT NULL              COMMENT 'pitfall坑/script话术/quiz演练/cognition认知/action行动/exclusive专属',
  `title`           VARCHAR(256)    DEFAULT NULL,
  `body`            TEXT            NOT NULL              COMMENT '≤120 字文案',
  `copyable`        TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '话术卡长按复制',
  `options_json`    JSON            DEFAULT NULL          COMMENT '演练卡选项 [{key,text,correct,explain}]',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'on',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_topic_order` (`topic_id`, `order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='锦囊卡片（CMS 数据格式见增补 v1.0 §9.5）';

DROP TABLE IF EXISTS `exclusive_card`;
CREATE TABLE `exclusive_card` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invite_id`       BIGINT UNSIGNED NOT NULL,
  `topic_id`        BIGINT UNSIGNED NOT NULL,
  `requester_uid`   BIGINT UNSIGNED NOT NULL              COMMENT '触发人生成者（审计）',
  `content`         TEXT            DEFAULT NULL          COMMENT '生成的专属建议 180-250 字',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT 'pending / ready / degraded（降级为通用版）/ rejected',
  `prompt_version`  VARCHAR(16)     NOT NULL              COMMENT 'prompt 模板版本（增补 v1.0 §9.2）',
  `model`           VARCHAR(64)     DEFAULT NULL,
  `check_result`    JSON            DEFAULT NULL          COMMENT '禁词校验结果',
  `generated_at`    DATETIME        DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invite_topic` (`invite_id`, `topic_id`)   COMMENT '同一邀请同一议题只生成一次（缓存）',
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 个性化专属卡（生成一次缓存）';

DROP TABLE IF EXISTS `topic_read_progress`;
CREATE TABLE `topic_read_progress` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `topic_id`        BIGINT UNSIGNED NOT NULL,
  `last_order_no`   INT UNSIGNED    NOT NULL DEFAULT 0    COMMENT '续看位置（§9.4）',
  `finished`        TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '已学会打卡',
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_topic` (`user_id`, `topic_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='议题阅读进度';

-- -------------------------------------------------------------
-- 七、配置域：计分规则 / 报告模板 / 商品 / 运营位 / 功能开关
-- -------------------------------------------------------------

DROP TABLE IF EXISTS `scoring_rule`;
CREATE TABLE `scoring_rule` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scale_version_id` BIGINT UNSIGNED NOT NULL,
  `aggregate_method` VARCHAR(32)    NOT NULL DEFAULT 'mean_normalized'
                    COMMENT '维度聚合：mean_normalized = (均分-1)×25 → 0-100（阶段 0 裁决 D-2）',
  `diff_threshold_high` INT          NOT NULL DEFAULT 15  COMMENT '差值下限（含），归入较低一级（D6）',
  `diff_threshold_mid`  INT          NOT NULL DEFAULT 30  COMMENT '差值上限（含），归入较低一级（D6）',
  `labels_json`     JSON            NOT NULL              COMMENT '分级命名：高共识 / 待沟通 / 重点待沟通（中性，P7）',
  `quality_min_sec` INT UNSIGNED    NOT NULL DEFAULT 180  COMMENT '低质量判定：总时长 <3 分钟（B3）',
  `version`         VARCHAR(16)     NOT NULL DEFAULT '1.0',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'on',
  `updated_by`      BIGINT UNSIGNED DEFAULT NULL,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scale_version_rule` (`scale_version_id`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='计分域配置';

DROP TABLE IF EXISTS `report_template`;
CREATE TABLE `report_template` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`            VARCHAR(32)     NOT NULL,
  `scale_version_id` BIGINT UNSIGNED NOT NULL,
  `audience`        VARCHAR(16)     NOT NULL              COMMENT 'audience：single 单人 / double 双人',
  `relation_status` VARCHAR(16)     DEFAULT NULL          COMMENT '备婚 / 相亲（多模板）',
  `level`           VARCHAR(8)      NOT NULL              COMMENT 'L1 / L2 / L3',
  `disclaimer`      VARCHAR(512)    NOT NULL              COMMENT '页脚免责声明（2.3 固定文案）',
  `version`         VARCHAR(16)     NOT NULL DEFAULT '1.0',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'on',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code_version` (`code`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报告模板（按人群 × 可见层级多维）';

DROP TABLE IF EXISTS `report_template_block`;
CREATE TABLE `report_template_block` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `template_id`     BIGINT UNSIGNED NOT NULL,
  `block_key`       VARCHAR(32)     NOT NULL              COMMENT '维度解读 / 对话建议 / 待沟通区 / 共识区 / 结尾总结',
  `order_no`        INT UNSIGNED    NOT NULL DEFAULT 0,
  `min_chars`       INT UNSIGNED    DEFAULT NULL          COMMENT '内容详实度下限（价值感标准 §一）',
  `template_text`   TEXT            NOT NULL              COMMENT '占位符文本：{维度名} {分数} {昵称A} {昵称B} {差值}',
  PRIMARY KEY (`id`),
  KEY `idx_template_order` (`template_id`, `order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报告模板区块（占位符渲染）';

DROP TABLE IF EXISTS `product`;
CREATE TABLE `product` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`            VARCHAR(32)     NOT NULL              COMMENT 'double_invite / topic_single / topic_bundle',
  `name`            VARCHAR(64)     NOT NULL,
  `price`           DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT 'P1 全免费=0；P2 按定价 v0.2（8 / 3 / 19.9）',
  `benefits_json`   JSON            DEFAULT NULL          COMMENT '包含权益',
  `ios_visible`     TINYINT(1)      NOT NULL DEFAULT 0    COMMENT 'iOS 隐藏购买入口（PRD-005 §4）',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'on',
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品表（P1 仅作展示，不启用支付）';

DROP TABLE IF EXISTS `ops_slot`;
CREATE TABLE `ops_slot` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `position`        VARCHAR(32)     NOT NULL              COMMENT 'home_banner / home_entry / popup / share_card',
  `title`           VARCHAR(128)    DEFAULT NULL,
  `subtitle`        VARCHAR(256)    DEFAULT NULL,
  `image_url`       VARCHAR(512)    DEFAULT NULL          COMMENT 'COS 地址',
  `link_url`        VARCHAR(512)    DEFAULT NULL,
  `ext_json`        JSON            DEFAULT NULL,
  `order_no`        INT UNSIGNED    NOT NULL DEFAULT 0,
  `start_at`        DATETIME        DEFAULT NULL,
  `end_at`          DATETIME        DEFAULT NULL,
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'on',
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_position_status` (`position`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运营位（零发版改首页文案/海报 G2）';

DROP TABLE IF EXISTS `feature_flag`;
CREATE TABLE `feature_flag` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key`             VARCHAR(64)     NOT NULL              COMMENT '如 baseline_notice_enabled / minor_block_enabled',
  `value`           VARCHAR(64)     NOT NULL              COMMENT '开关值',
  `description`     VARCHAR(256)    DEFAULT NULL,
  `updated_by`      BIGINT UNSIGNED DEFAULT NULL,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='全局功能开关';

DROP TABLE IF EXISTS `sensitive_word`;
CREATE TABLE `sensitive_word` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `word`            VARCHAR(64)     NOT NULL              COMMENT '词/短语，命中即拦截',
  `scope`           VARCHAR(16)     NOT NULL DEFAULT 'nickname' COMMENT 'nickname / exclusive_card / all',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'on' COMMENT 'on / off（运营可临时停用）',
  `remark`          VARCHAR(128)    DEFAULT NULL          COMMENT '备注（命中原因分类）',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_word_scope` (`word`, `scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='本地敏感词兜底表（内容域配置，P5 禁止硬编码；权威检测仍以微信内容安全接口为准）';

-- -------------------------------------------------------------
-- 八、支付与权益（P2 预留：建表保留，本版本不写入）
-- -------------------------------------------------------------

DROP TABLE IF EXISTS `order`;
CREATE TABLE `order` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `out_trade_no`    VARCHAR(64)     NOT NULL              COMMENT '商户订单号（幂等键 E2）',
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `product_id`      BIGINT UNSIGNED NOT NULL,
  `product_snapshot` JSON           NOT NULL              COMMENT '下单时商品快照（改价不影响历史订单 E6）',
  `amount`          DECIMAL(10,2)   NOT NULL              COMMENT '金额以后端为准（E4）',
  `status`          VARCHAR(24)     NOT NULL DEFAULT 'created'
                    COMMENT 'created / paying / paid / closed / refunding / refunded（超时 30 分钟关闭 E3）',
  `prepay_id`       VARCHAR(64)     DEFAULT NULL,
  `transaction_id`  VARCHAR(64)     DEFAULT NULL          COMMENT '微信支付单号',
  `paid_at`         DATETIME        DEFAULT NULL,
  `expire_at`       DATETIME        DEFAULT NULL,
  `refunded_at`     DATETIME        DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_out_trade_no` (`out_trade_no`),
  KEY `idx_user_status` (`user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单（P2 预留）';

DROP TABLE IF EXISTS `entitlement`;
CREATE TABLE `entitlement` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `product_id`      BIGINT UNSIGNED NOT NULL,
  `source`          VARCHAR(16)     NOT NULL              COMMENT 'order / coupon / manual（E8）',
  `source_ref`      VARCHAR(64)     DEFAULT NULL          COMMENT '来源单号或兑换码',
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'active' COMMENT 'active / revoked（退款收回 E10）',
  `granted_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expire_at`       DATETIME        DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_source_ref` (`source_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='权益（服务端唯一可信，PRD-005 §1）';

DROP TABLE IF EXISTS `coupon`;
CREATE TABLE `coupon` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`            VARCHAR(32)     NOT NULL              COMMENT '兑换码（iOS 过渡，E8）',
  `product_id`      BIGINT UNSIGNED NOT NULL,
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'unused' COMMENT 'unused / used / expired',
  `used_by`         BIGINT UNSIGNED DEFAULT NULL,
  `used_at`         DATETIME        DEFAULT NULL,
  `expire_at`       DATETIME        NOT NULL              COMMENT '7 天有效',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='兑换码池（P2 预留）';

DROP TABLE IF EXISTS `payment_notify_log`;
CREATE TABLE `payment_notify_log` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `out_trade_no`    VARCHAR(64)     DEFAULT NULL,
  `raw_body`        TEXT            NOT NULL              COMMENT '原始回调报文（留证）',
  `verify_result`   TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '验签结果，伪造回调记 0',
  `idempotent_hit`  TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '是否命中幂等',
  `processed`       TINYINT(1)      NOT NULL DEFAULT 0,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_out_trade_no` (`out_trade_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='支付回调日志（P2 预留，验签+幂等留证）';

-- -------------------------------------------------------------
-- 九、审计与运维
-- -------------------------------------------------------------

DROP TABLE IF EXISTS `audit_log`;
CREATE TABLE `audit_log` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_type`      VARCHAR(16)     NOT NULL              COMMENT 'user / admin / system',
  `actor_id`        BIGINT UNSIGNED DEFAULT NULL,
  `action`          VARCHAR(48)     NOT NULL              COMMENT 'report_access_denied / exclusive_card_generate / config_update …',
  `target_type`     VARCHAR(32)     DEFAULT NULL,
  `target_id`       VARCHAR(64)     DEFAULT NULL,
  `detail_json`     JSON            DEFAULT NULL,
  `ip`              VARCHAR(64)     DEFAULT NULL,
  `user_agent`      VARCHAR(256)    DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_action_created` (`action`, `created_at`),
  KEY `idx_actor` (`actor_type`, `actor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审计日志（越权/配置变更/生成行为/合规检查）';

DROP TABLE IF EXISTS `job_task`;
CREATE TABLE `job_task` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type`            VARCHAR(32)     NOT NULL              COMMENT 'report_generate / share_image / invite_expire',
  `biz_id`          VARCHAR(64)     NOT NULL,
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT 'pending / running / done / failed',
  `retry_count`     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `last_error`      VARCHAR(512)    DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_type_status` (`type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='异步任务（报告生成/长图/过期扫描，失败转人工工单 D1）';

-- -------------------------------------------------------------
-- 十、初始配置数据（仅兜底用，运营可在后台增删）
-- -------------------------------------------------------------

-- 本地敏感词兜底表初始数据
-- 说明：权威检测是微信内容安全接口（A6）；本表只兜底「广告导流 + 违法类」等
--       结构清晰的违规模式，辱骂/涉政等语义类词一律交给微信接口判定，避免误杀。
INSERT IGNORE INTO `sensitive_word` (`word`, `scope`, `remark`) VALUES
  ('加微信',   'all', '广告导流'),
  ('加我微信', 'all', '广告导流'),
  ('微信同号', 'all', '广告导流'),
  ('加V',      'all', '广告导流'),
  ('微商',     'all', '广告导流'),
  ('代购',     'all', '广告导流'),
  ('刷单',     'all', '广告导流'),
  ('兼职日结', 'all', '广告导流'),
  ('刷粉',     'all', '广告导流'),
  ('引流',     'all', '广告导流'),
  ('低价代充', 'all', '广告导流'),
  ('售号',     'all', '广告导流'),
  ('贷款',     'all', '违法类'),
  ('套现',     'all', '违法类'),
  ('办证',     'all', '违法类'),
  ('发票代开', 'all', '违法类'),
  ('博彩',     'all', '违法类'),
  ('赌博',     'all', '违法类'),
  ('六合彩',   'all', '违法类'),
  ('色情',     'all', '违法类'),
  ('裸聊',     'all', '违法类'),
  ('卖号',     'all', '违法类');

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================
-- 表清单速览（共 30 张）
-- 账号：user / account_deletion_request / nickname_review / admin_user
-- 量表：scale / scale_version / scale_dimension / scale_question
-- 答题：answer_sheet / answer_snapshot
-- 邀请：invite
-- 报告：report / visibility_log
-- 内容：topic / topic_card / exclusive_card / topic_read_progress
-- 配置：scoring_rule / report_template / report_template_block / product / ops_slot / feature_flag / sensitive_word
-- 支付（P2 预留）：order / entitlement / coupon / payment_notify_log
-- 运维：audit_log / job_task
-- =============================================================
