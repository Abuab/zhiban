<script setup lang="ts">
/**
 * 同意弹窗（隐私政策 / 年龄确认）
 * 规格依据：宪法 §2.4
 *   - 启动即弹《隐私政策》，不同意则仅可浏览首页
 *   - 未满 18 岁不可使用
 * 交互约定：不使用遮罩点击关闭，必须显式选择，确保同意/拒绝都有明确留痕
 */
import { PRIVACY_POLICY_PATH } from '../../constants/privacy';
import { brandName } from '../../stores/app-config';

const props = defineProps<{
  visible: boolean;
  /** privacy 隐私政策 / age 年龄确认 */
  mode: 'privacy' | 'age';
}>();

const emit = defineEmits<{
  (e: 'accept'): void;
  (e: 'reject'): void;
}>();

function openPolicy(): void {
  uni.navigateTo({ url: PRIVACY_POLICY_PATH });
}
</script>

<template>
  <view v-if="props.visible" class="mask">
    <view class="modal">
      <view class="modal__title">{{ props.mode === 'privacy' ? '隐私政策' : '年龄确认' }}</view>

      <view v-if="props.mode === 'privacy'" class="modal__body">
        <text class="paragraph">
          {{ brandName }}需要你的微信授权以创建账号，并保存你的测评作答与报告。
        </text>
        <text class="paragraph">我们只收集必要的服务数据：</text>
        <text class="paragraph">· 微信账号标识（用于识别你的账号，换手机后权益自动跟随）</text>
        <text class="paragraph">· 测评答案与报告（用于生成结果，仅你本人与你自己授权的对比对象可见）</text>
        <text class="paragraph">我们不会收集你的真实姓名、身份证号、通讯录或精确位置，也不会向第三方出售你的数据。</text>
        <text class="paragraph">不同意将无法使用测评与报告功能，但你仍可浏览首页。</text>
        <text class="link" @tap="openPolicy">查看《隐私政策》全文</text>
      </view>

      <view v-else class="modal__body">
        <text class="paragraph">本产品用于伴侣关系自评与沟通参考，仅面向已满 18 周岁的用户。</text>
        <text class="paragraph">请确认你的年龄后继续。</text>
      </view>

      <view class="modal__actions">
        <button class="btn btn--primary" @tap="emit('accept')">
          {{ props.mode === 'privacy' ? '同意并继续' : '我已满 18 周岁' }}
        </button>
        <button class="btn btn--ghost" @tap="emit('reject')">
          {{ props.mode === 'privacy' ? '不同意' : '我未满 18 周岁' }}
        </button>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  background-color: rgba(43, 38, 34, 0.55);
}

.modal {
  width: 100%;
  max-height: 80vh;
  padding: 40rpx;
  overflow-y: auto;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &__title {
    margin-bottom: 24rpx;
    font-size: 34rpx;
    font-weight: 600;
  }

  &__body {
    display: flex;
    flex-direction: column;
  }

  &__actions {
    margin-top: 40rpx;
  }
}

.paragraph {
  margin-bottom: 16rpx;
  color: $zb-color-text;
  line-height: 1.7;
}

.link {
  margin-top: 8rpx;
  color: $zb-color-primary;
  text-decoration: underline;
}

.btn {
  margin-bottom: 16rpx;
  font-size: 30rpx;

  &--primary {
    color: $zb-color-surface;
    background-color: $zb-color-primary;
  }

  &--ghost {
    color: $zb-color-text-secondary;
    background-color: transparent;
    border: 1rpx solid $zb-color-text-secondary;
  }

  &::after {
    border: none;
  }
}
</style>
