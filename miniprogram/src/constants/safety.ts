/**
 * 「隐私与安全检查」页常量（ADR-010）
 *
 * 原则（同 constants/assessment.ts）：只放**结构性常量与规格已固定的文案**；
 * 随运营变化的文案由服务端下发 —— 自查清单走 `sys_config` 的 `safety.selfcheck.items`、
 * 客服二维码与说明走 `support.qrcode_url` / `support.qrcode_tip`。
 * 本文件里的文案只在**接口失败**时兜底，不阻塞页面渲染（边界总表 A5 不出现死页）。
 *
 * 规格依据：ADR-010、constitution.md P3（隐私即卖点）/ P5（文案可配置）/ P7（不评判）
 */

/** 页面路径（入口与跳转共用一处登记，避免路径写散） */
export const SAFETY_PAGE_PATH = '/pages/safety/safety';

/** 区块标题（4 个区块自上而下） */
export const SAFETY_SECTION_TITLES = {
  DATA: '我们对你的数据做了什么',
  SELF_CHECK: '婚前事实确认清单',
  SUPPORT: '如果你需要帮助',
  CONTROL: '你的数据你能控制',
} as const;

/** 区块①：4 条事实陈述，与《隐私政策》第一、四、六章同源，不得出现比政策更强的承诺 */
export const SAFETY_DATA_FACTS: readonly string[] = [
  '只收集生成报告所必需的信息，不读取你的通讯录与相册',
  '你的作答只有你和这次配对的对象能看到，且双方可见的范围不同',
  '数据存储在中国境内，传输全程加密',
  '你可以随时撤回同意、删除本次配对数据或注销账号',
];

/**
 * 区块②：婚前事实确认清单的**兜底**内容
 * 真源是 `sys_config` 的 `safety.selfcheck.items`（与 docs/schema.sql 种子逐字一致）；
 * 接口未就绪或返回空数组时用本常量渲染，保证页面不空白。
 */
export const SAFETY_FALLBACK_SELFCHECK_ITEMS: readonly string[] = [
  '你已了解对方的婚姻状况（含既往婚史）',
  '你已了解对方当前的负债情况',
  '你已了解对方是否有成瘾相关经历',
  '你已了解对方的个人征信情况',
  '你们已交换婚前体检结果',
  '你已了解对方是否有重大病史',
  '关于彩礼与房产，你们已达成明确共识',
  '你们已互留紧急联系人信息',
];

/**
 * 区块②顶部的数据说明（硬性：本清单不落库、不上传、不分享）
 * ADR-010 决策 2 —— 页内勾选只存在于页面 data，离开页面即丢弃。
 */
export const SAFETY_SELF_CHECK_NOTICE = '本清单只在本页使用，不会保存，也不会分享给任何人';

/** 区块②底部的再次说明（防止用户误以为勾选结果会影响报告） */
export const SAFETY_SELF_CHECK_FOOTNOTE = '勾选只帮你把事实过一遍，不参与计分，也不影响报告内容';

/** 区块③：客服入口按钮文案（点击后打开小程序内客服会话） */
export const SAFETY_SUPPORT_BUTTON_TEXT = '联系在线客服';

/** 区块③脚注：本产品不提供心理诊断、心理咨询或法律意见（ADR-010 七、合规约束） */
export const SAFETY_SUPPORT_FOOTNOTE =
  '我们只能帮你把该确认的事情过一遍，不能替代心理诊断、心理咨询或法律意见';

/** 区块④：数据控制入口文案 */
export const SAFETY_CONTROL_ITEMS = {
  PRIVACY: '撤回隐私政策同意',
  DELETE_PAIRING: '删除本次配对数据',
  LOGOUT: '注销账号',
} as const;

/**
 * 首页底部常驻弱入口的文案
 * 与页面标题（pages.json 的「隐私与安全检查」）同措辞，便于用户把入口与落地页对上
 */
export const SAFETY_ENTRY_TEXT = '隐私与安全检查';

/**
 * 区块④每行的补充说明：说清「这个动作的后果」与「去哪里完成」
 *
 * PRIVACY：后果口径与《隐私政策》第七章「撤回同意……仍可浏览首页」保持一致（不写更强的承诺）
 * DELETE_PAIRING：删除动作在邀请详情页完成（ADR-011），本页只做入口，避免两处各写一套删除逻辑
 * LOGOUT：端上暂无自助注销能力，此处只如实说明现状并指向本页既有的客服入口，不虚构功能
 */
export const SAFETY_CONTROL_NOTES = {
  PRIVACY: '撤回后你将无法使用测评与报告功能，但仍可浏览首页；重新同意即可继续使用',
  DELETE_PAIRING: '在对应的邀请详情里完成删除',
  LOGOUT: `端上暂未开放自助注销入口；如需注销，可通过本页的「${SAFETY_SUPPORT_BUTTON_TEXT}」入口提交，我们会与你核对身份后处理`,
} as const;

/** 撤回同意成功后的提示（沿用《隐私政策》第七章的可见范围口径） */
export const SAFETY_REVOKE_TOAST = '已撤回隐私政策同意，仅可浏览首页';

/** 撤回同意弹窗的确认按钮文案（用「撤回」而不是「确定」，降低误触后的不可逆感） */
export const SAFETY_REVOKE_CONFIRM_TEXT = '撤回';
