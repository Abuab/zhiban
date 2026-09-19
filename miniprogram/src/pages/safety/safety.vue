<script setup lang="ts">
/**
 * 「隐私与安全检查」页（ADR-010）
 *
 * 规格依据：
 *   - ADR-010 决策 1：一页 4 区块（数据说明 / 自查清单 / 求助引导 / 数据控制入口）
 *   - ADR-010 决策 2：区块②的勾选**不落库、不上传、不参与计分**
 *   - ADR-010 决策 5「5) 端上行为」：二维码未配置/非法/加载失败一律按未配置处理
 *   - 宪法 P3（数据最小化）/ P5（文案可配置）/ P7（不评判、不量化风险）
 *
 * 三点刻意为之：
 *   1. 本页**不新增任何接口**：文案来自启动时已拉取的站点公开配置（`stores/app-config.ts`），
 *      勾选状态只在本页内存里，离开即丢弃 —— 这是决策 2 的核心，不是遗漏。
 *   2. 本页**不对「你的关系是否安全」下任何结论**：自查清单只陈述「可确认的事实事项」，
 *      不给评分、不给结论、不给建议（P7 与 ADR-010 七）。
 *   3. 区块③只做求助引导，不列任何外部渠道 —— 未核实来源的援助热线一律不编造。
 */
import { computed, ref } from 'vue';
import {
  SAFETY_CONTROL_ITEMS,
  SAFETY_CONTROL_NOTES,
  SAFETY_DATA_FACTS,
  SAFETY_REVOKE_CONFIRM_TEXT,
  SAFETY_REVOKE_TOAST,
  SAFETY_SECTION_TITLES,
  SAFETY_SELF_CHECK_FOOTNOTE,
  SAFETY_SELF_CHECK_NOTICE,
  SAFETY_SUPPORT_BUTTON_TEXT,
  SAFETY_SUPPORT_FOOTNOTE,
} from '../../constants/safety';
import { INVITE_LIST_PAGE_PATH } from '../../constants/invite';
import { safetySelfCheckItems, supportQrcodeTip, supportQrcodeUrl } from '../../stores/app-config';
import { refusePrivacyPolicy } from '../../utils/auth';

// ------------------------------------------------------------------ 区块② 勾选

/**
 * 勾选状态：只存在于本页内存（ADR-010 决策 2 硬性要求）
 * 因此这里**没有**任何持久化读写 —— 不落库、不上传、不写本地存储；
 * 返回本页时也不恢复（勾选只是帮用户当场把事实过一遍）。
 */
const checkedIndexes = ref<Record<number, boolean>>({});

function isChecked(index: number): boolean {
  return checkedIndexes.value[index] === true;
}

/** 整体替换对象而不是改属性：保证小程序端视图一定刷新 */
function toggle(index: number): void {
  checkedIndexes.value = { ...checkedIndexes.value, [index]: !isChecked(index) };
}

// ------------------------------------------------------------------ 区块③ 二维码

/**
 * 二维码加载失败标记（本地态）
 * 地址为空 = 服务端未配置或未通过 https 校验（fail-closed 已在 store 收敛），
 * 此时连图片节点都不渲染；加载失败再置一次标记，两种情况都不会留下破图或空图框。
 */
const qrcodeFailed = ref(false);

const showQrcode = computed(() => supportQrcodeUrl.value !== '' && !qrcodeFailed.value);

function handleQrcodeError(): void {
  qrcodeFailed.value = true;
}

// ------------------------------------------------------------------ 区块④ 数据控制

/**
 * 撤回隐私政策同意：直接复用既有能力（`utils/auth.ts` 的 `refusePrivacyPolicy`，
 * 首页隐私弹窗的「不同意」走的就是它），端上不再写第二套撤回逻辑。
 * 先弹确认框：撤回会清掉登录态，属于不可逆动作，用后果说明把用户拦住一次。
 */
function handleRevokePrivacy(): void {
  uni.showModal({
    title: SAFETY_CONTROL_ITEMS.PRIVACY,
    content: SAFETY_CONTROL_NOTES.PRIVACY,
    confirmText: SAFETY_REVOKE_CONFIRM_TEXT,
    success: (res) => {
      if (!res.confirm) return;
      refusePrivacyPolicy();
      uni.showToast({ title: SAFETY_REVOKE_TOAST, icon: 'none' });
    },
  });
}

/**
 * 删除本次配对数据：本页只做跳转入口
 * 删除动作的实现在邀请详情页（ADR-011，另一个变更负责），此处不调任何删除接口 ——
 * 否则同一个删除会出现两套端上实现，口径必然分叉。
 */
function handleDeletePairing(): void {
  uni.navigateTo({ url: INVITE_LIST_PAGE_PATH });
}
</script>

<template>
  <view class="page">
    <!-- 区块① 数据说明：与《隐私政策》第一、四、六章同源，不出现比政策更强的承诺 -->
    <view class="card">
      <view class="card__title">{{ SAFETY_SECTION_TITLES.DATA }}</view>
      <text v-for="(fact, index) in SAFETY_DATA_FACTS" :key="index" class="fact">· {{ fact }}</text>
    </view>

    <!-- 区块② 婚前事实确认清单：可勾选，但不计分、不上传、不落库 -->
    <view class="card">
      <view class="card__title">{{ SAFETY_SECTION_TITLES.SELF_CHECK }}</view>
      <view class="notice">{{ SAFETY_SELF_CHECK_NOTICE }}</view>
      <view
        v-for="(item, index) in safetySelfCheckItems"
        :key="index"
        class="check"
        @tap="toggle(index)"
      >
        <view class="check__box" :class="{ 'check__box--on': isChecked(index) }" />
        <text class="check__text" :class="{ 'check__text--on': isChecked(index) }">{{ item }}</text>
      </view>
      <view class="footnote">{{ SAFETY_SELF_CHECK_FOOTNOTE }}</view>
    </view>

    <!-- 区块③ 求助引导：只有小程序内客服入口与后台可配的客服二维码，不列任何外部渠道 -->
    <view class="card">
      <view class="card__title">{{ SAFETY_SECTION_TITLES.SUPPORT }}</view>
      <button class="contact" open-type="contact">{{ SAFETY_SUPPORT_BUTTON_TEXT }}</button>
      <view v-if="showQrcode" class="qrcode">
        <image class="qrcode__image" :src="supportQrcodeUrl" mode="widthFix" @error="handleQrcodeError" />
        <view v-if="supportQrcodeTip" class="qrcode__tip">{{ supportQrcodeTip }}</view>
      </view>
      <view class="footnote">{{ SAFETY_SUPPORT_FOOTNOTE }}</view>
    </view>

    <!-- 区块④ 数据控制：三个入口，能力分散在既有页面，本页只负责把用户送过去 -->
    <view class="card">
      <view class="card__title">{{ SAFETY_SECTION_TITLES.CONTROL }}</view>
      <view class="control" @tap="handleRevokePrivacy">
        <view class="control__name">{{ SAFETY_CONTROL_ITEMS.PRIVACY }}</view>
        <view class="control__note">{{ SAFETY_CONTROL_NOTES.PRIVACY }}</view>
      </view>
      <view class="control" @tap="handleDeletePairing">
        <view class="control__name">{{ SAFETY_CONTROL_ITEMS.DELETE_PAIRING }}</view>
        <view class="control__note">{{ SAFETY_CONTROL_NOTES.DELETE_PAIRING }}</view>
      </view>
      <!--
        注销账号：端上暂无自助能力。这里**不绑定点击**，只如实说明现状并指向本页客服入口 ——
        做一个点了没反应的入口比没有入口更糟；缺口已登记在交付报告。
      -->
      <view class="control">
        <view class="control__name">{{ SAFETY_CONTROL_ITEMS.LOGOUT }}</view>
        <view class="control__note">{{ SAFETY_CONTROL_NOTES.LOGOUT }}</view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  padding: 32rpx 32rpx 64rpx;
}

.card {
  padding: 32rpx;
  margin-bottom: 24rpx;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &__title {
    margin-bottom: 16rpx;
    font-size: 32rpx;
    font-weight: 600;
  }
}

/* 区块① 事实陈述 */
.fact {
  display: block;
  margin-bottom: 12rpx;
  line-height: 1.8;

  &:last-child {
    margin-bottom: 0;
  }
}

/* 区块② 数据说明条：与勾选区做视觉区分，避免被当成清单的第一条 */
.notice {
  padding: 16rpx 20rpx;
  margin-bottom: 16rpx;
  color: $zb-color-text-secondary;
  font-size: 24rpx;
  line-height: 1.6;
  background-color: $zb-color-warning-bg;
  border: 1rpx solid $zb-color-warning-border;
  border-radius: $zb-radius-card;
}

.check {
  display: flex;
  align-items: flex-start;
  padding: 20rpx 0;
  /* 每行都带下边框：最后一条的下边框正好充当脚注的分隔线 */
  border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

  &__box {
    position: relative;
    flex-shrink: 0;
    width: 36rpx;
    height: 36rpx;
    margin-top: 4rpx;
    margin-right: 20rpx;
    border: 2rpx solid #d8cfc7;
    border-radius: 8rpx;

    /* 勾：用两条边旋转 45° 画出来，避免依赖字体里是否有点符号 */
    &--on {
      background-color: $zb-color-primary;
      border-color: $zb-color-primary;

      &::after {
        position: absolute;
        top: 6rpx;
        left: 11rpx;
        width: 10rpx;
        height: 18rpx;
        content: '';
        border-right: 3rpx solid $zb-color-surface;
        border-bottom: 3rpx solid $zb-color-surface;
        transform: rotate(45deg);
      }
    }
  }

  &__text {
    flex: 1;
    font-size: $zb-font-size-base;
    line-height: 1.7;

    &--on {
      color: $zb-color-text-secondary;
    }
  }
}

/* 脚注（区块②③共用）：说明本页能力的边界；不加上边框，避免与上一条勾选行的下边框叠成双线 */
.footnote {
  padding-top: 24rpx;
  color: $zb-color-text-secondary;
  font-size: 24rpx;
  line-height: 1.7;
}

/* 区块③ 客服按钮与二维码 */
.contact {
  margin-top: 8rpx;
  font-size: $zb-font-size-base;
  color: $zb-color-surface;
  background-color: $zb-color-primary;

  &:active {
    background-color: $zb-color-primary-dark;
  }

  &::after {
    border: none;
  }
}

.qrcode {
  margin-top: 32rpx;
  text-align: center;

  &__image {
    width: 360rpx;
    border-radius: $zb-radius-card;
  }

  &__tip {
    margin-top: 12rpx;
    color: $zb-color-text-secondary;
    font-size: 24rpx;
  }
}

/* 区块④ 数据控制入口 */
.control {
  padding: 20rpx 0;
  border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

  &:last-child {
    border-bottom: none;
  }

  &__name {
    font-size: $zb-font-size-base;
    color: $zb-color-text;
  }

  &__note {
    margin-top: 8rpx;
    color: $zb-color-text-secondary;
    font-size: 24rpx;
    line-height: 1.6;
  }
}
</style>
