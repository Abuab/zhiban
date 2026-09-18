<script setup lang="ts">
/**
 * 隐私政策全文页
 * 规格依据：
 *   - 宪法 §2.4「启动即弹《隐私政策》，不同意则仅可浏览首页」
 *   - 规范增补 v0.3 §3.3「隐私政策须说明双人数据的持有关系、被邀请方可见范围、解锁机制」
 * 说明：
 *   1. 正文与 docs/privacy-policy.md 保持一致，版本号与 constants/privacy.ts 同源
 *   2. 页面只读展示，不做任何数据收集动作
 */
import { PRIVACY_POLICY_VERSION } from '../../constants/privacy';

interface Section {
  title: string;
  paragraphs: string[];
  items?: string[];
}

const sections: Section[] = [
  {
    title: '一、我们收集哪些信息',
    paragraphs: ['为提供测评与报告服务，我们仅收集以下必要信息：'],
    items: [
      '微信账号标识（openid / unionid）：用于创建并识别你的账号。换手机或重装微信后，你的测评记录与权益会自动跟随。',
      '昵称与头像（你主动填写时）：仅用于页面展示，可随时修改或清空。',
      '测评作答数据与测评报告：用于生成结果、生成双人对比报告。',
      '设备与访问日志（IP 地址、设备型号、操作系统、访问时间）：用于安全风控（识别异常登录与刷量）和故障排查。',
    ],
  },
  {
    title: '二、我们不会收集哪些信息',
    paragraphs: ['本产品遵循最小化收集原则，明确不收集：'],
    items: [
      '真实姓名、身份证号、人脸等身份信息',
      '手机通讯录、通话记录、短信',
      '精确地理位置',
      '支付账户与银行卡信息（当前版本全部内容免费，不涉及任何支付）',
    ],
  },
  {
    title: '三、我们如何使用信息',
    paragraphs: [
      '测评作答数据仅用于计算你的测评结果与生成报告，并用于向你展示与你本人相关的内容。',
      '昵称提交时会经过内容合规校验；校验不通过的昵称将进入人工审核流程，不会直接公开展示。',
      '访问日志仅用于安全防护与问题定位，不用于用户画像或广告投放。',
    ],
  },
  {
    title: '四、双人对比数据说明',
    paragraphs: [
      '当你发起双人共同评估时，双方都需要在作答前勾选知情同意：你们的答案将共同生成一份关系分析；详细分析由发起人持有，你可以看到基础摘要。',
      '详细分析（各维度差值、待沟通区明细、逐题分歧）仅发起方可见。',
      '被邀请方可见范围限于：共同完成纪念卡、共识区内容（仅正向内容）。被邀请方不可见任何维度差值、分歧题目与对方的单人答案。',
      '在对方完成作答之前，发起方仅能看到「待对方完成」状态，无法单方生成任何对比结论。',
      '任何一方的单人测评报告仅本人可见，不会展示给其他人。',
    ],
  },
  {
    title: '五、信息共享与第三方',
    paragraphs: [
      '我们不会向任何第三方出售你的个人信息。',
      '为完成昵称内容合规校验，昵称文本会提交至微信内容安全接口进行检测。',
      '除法律法规要求或你明确授权外，我们不会将你的信息提供给其他第三方。',
    ],
  },
  {
    title: '六、存储与安全',
    paragraphs: [
      '你的数据存储于中国境内服务器。',
      '网络传输全程加密，数据库访问遵循最小权限原则，敏感密钥仅存放于服务器环境变量，不进入代码仓库。',
      '尽管我们采取了合理的安全措施，但请理解互联网环境并非绝对安全，请妥善保管你的微信账号。',
    ],
  },
  {
    title: '七、你的权利',
    paragraphs: ['你可以随时行使以下权利：'],
    items: [
      '查阅与更正：在小程序内查看并修改你的昵称、头像。',
      '撤回同意：拒绝或撤回隐私政策同意后，你将无法使用测评与报告功能，但仍可浏览首页。',
      '注销账号：注销后我们将物理删除你的答题数据与报告，不做保留（法律法规另有要求的除外）。',
    ],
  },
  {
    title: '八、未成年人保护',
    paragraphs: [
      '本产品面向婚恋准备场景，仅面向已满 18 周岁的用户。',
      '若你未满 18 周岁，请勿使用本产品。',
    ],
  },
  {
    title: '九、政策更新',
    paragraphs: [
      '当本政策发生重大变更时，我们会在小程序内以显著方式提示你重新阅读并征得同意。',
      '你继续使用本产品即表示接受更新后的政策。',
    ],
  },
  {
    title: '十、联系我们',
    paragraphs: ['如你对本政策有任何疑问，或需要行使上述权利，可通过小程序内的客服入口与我们联系。'],
  },
];
</script>

<template>
  <view class="page">
    <view class="header">
      <view class="header__title">知伴隐私政策</view>
      <view class="header__meta">版本 {{ PRIVACY_POLICY_VERSION }}</view>
    </view>

    <view v-for="section in sections" :key="section.title" class="section">
      <view class="section__title">{{ section.title }}</view>
      <text v-for="(paragraph, index) in section.paragraphs" :key="index" class="paragraph">
        {{ paragraph }}
      </text>
      <text v-for="(item, index) in section.items ?? []" :key="`item-${index}`" class="item">
        · {{ item }}
      </text>
    </view>

    <view class="footer">
      本测评基于自评量表，结果仅供自我了解与伴侣沟通参考，不构成心理学诊断、心理咨询或婚姻法律建议。
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  padding: 40rpx 32rpx 80rpx;
}

.header {
  margin-bottom: 40rpx;

  &__title {
    font-size: 40rpx;
    font-weight: 600;
  }

  &__meta {
    margin-top: 8rpx;
    color: $zb-color-text-secondary;
    font-size: 24rpx;
  }
}

.section {
  margin-bottom: 40rpx;

  &__title {
    margin-bottom: 16rpx;
    font-size: 32rpx;
    font-weight: 600;
  }
}

.paragraph {
  display: block;
  margin-bottom: 12rpx;
  line-height: 1.8;
}

.item {
  display: block;
  margin-bottom: 12rpx;
  color: $zb-color-text-secondary;
  line-height: 1.8;
}

.footer {
  padding-top: 24rpx;
  color: $zb-color-text-secondary;
  font-size: 24rpx;
  line-height: 1.7;
  border-top: 1rpx solid #ece5df;
}
</style>
