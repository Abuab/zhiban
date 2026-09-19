<script setup lang="ts">
/**
 * 我的权益（模块 6）
 *
 * 规格依据：PRD-005 §1（解锁判定只读服务端）/ §4（iOS 策略）/ §5（退款与客诉）、
 *   边界总表 E1（恢复购买）/ E3（超时关闭）/ E4（金额以后端为准）/ E8（兑换码）、
 *   宪法 §2.5（P1 全免费）、docs/adr/ADR-007.md 决策 1（可切换网关）、docs/adr/ADR-009.md（本页形态）
 *
 * 实现要点：
 *   1. **解锁态只读服务端**（§14.0 不变式 1）：每次 `onShow` 重新并发拉取商品 / 权益 / 订单，
 *      不用本地缓存判定「已解锁」；领取或兑换成功后同样整体重载，避免端上拼接状态。
 *   2. **金额一律由服务端决定**（E4）：下单只传 `productCode`；展示的价格与订单金额都取自接口，
 *      端上不写死任何金额。
 *   3. **iOS 隐藏购买入口在 P1 免费期豁免**（ADR-009 决策 1）：`price = 0` 不涉及支付动作，
 *      故 iOS 也展示「领取」；`price > 0` 且 `iosVisible = false` 时才隐藏按钮并改给兑换码引导。
 *   4. `settled = false`（需要真实支付）在 P1 不可达；走到该分支只落订单并提示，不静默失败。
 *   5. 所有运营文案（商品名、价格、权益载荷、订单状态）来自接口，端上只承载结构性文案。
 */
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { paymentApi } from '../../api/payment';
import {
  BENEFIT_DESCRIPTIONS,
  BENEFIT_FALLBACK_DESCRIPTION,
  ENTITLEMENT_SOURCE_FALLBACK_LABEL,
  ENTITLEMENT_SOURCE_LABELS,
  IOS_PURCHASE_BLOCKED_HINT,
  ORDER_STATUS_FALLBACK_LABEL,
  ORDER_STATUS_LABELS,
  OWNED_BADGE,
  RESTORE_HINT,
} from '../../constants/entitlement';
import { ApiErrorCode } from '../../constants/error-code';
import {
  BENEFIT_TYPE_DOUBLE_REPORT,
  BENEFIT_TYPE_TOPIC_BUNDLE,
} from '../../types/payment';
import type { EntitlementSummary, OrderDetailView, ProductView } from '../../types/payment';
import { ensureLogin } from '../../utils/auth';
import { formatDate } from '../../utils/format';
import { ApiError } from '../../utils/request';

const loading = ref(true);
const errorText = ref('');
const products = ref<ProductView[]>([]);
const summary = ref<EntitlementSummary | null>(null);
const orders = ref<OrderDetailView[]>([]);

const couponCode = ref('');
const redeeming = ref(false);
const restoring = ref(false);
/** 正在领取的商品编码：同一时刻只允许一笔，避免连点产生多笔订单 */
const claimingCode = ref('');

const records = computed(() => summary.value?.items ?? []);
const topicCount = computed(() => summary.value?.topics.length ?? 0);

/** 商品编码 → 商品名（用于把权益记录里的裸编码换成用户看得懂的名字） */
const productNameMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const product of products.value) map[product.code] = product.name;
  return map;
});

onShow(() => {
  void load();
});

onPullDownRefresh(async () => {
  await load();
  uni.stopPullDownRefresh();
});

async function load(): Promise<void> {
  errorText.value = '';

  const ready = await ensureLogin();
  if (!ready) {
    loading.value = false;
    return;
  }

  try {
    // 三个接口并发：权益是页面主体，缺一片就无法判断解锁态，故任一失败都按整页错误处理
    const [productList, entitlementSummary, orderList] = await Promise.all([
      paymentApi.products(),
      paymentApi.entitlements(),
      paymentApi.myOrders(),
    ]);
    products.value = productList;
    summary.value = entitlementSummary;
    orders.value = orderList;
  } catch (error) {
    errorText.value = error instanceof ApiError ? error.message : '加载失败，请下拉重试';
  } finally {
    loading.value = false;
  }
}

// ------------------------------------------------------------------ 商品与权益

/** 当前是否 iOS 端（§4 的隐藏规则只针对 iOS） */
function isIosPlatform(): boolean {
  return uni.getSystemInfoSync().platform === 'ios';
}

/** 商品产出的**全部**权益都持有才算已解锁（发放是整笔发放，部分持有只可能是数据异常） */
function isOwned(product: ProductView): boolean {
  const current = summary.value;
  if (!current) return false;
  return product.benefits.every((benefit) => {
    if (benefit.type === BENEFIT_TYPE_DOUBLE_REPORT) return current.doubleReport;
    if (benefit.type === BENEFIT_TYPE_TOPIC_BUNDLE) return current.topicBundle;
    return current.topics.includes(benefit.topicCode);
  });
}

/** 是否展示领取按钮（免费商品豁免 iOS 隐藏，理由见 ADR-009 决策 1） */
function canClaim(product: ProductView): boolean {
  if (product.price === 0) return true;
  return !isIosPlatform() || product.iosVisible;
}

function claimActionLabel(product: ProductView): string {
  return product.price === 0 ? '免费领取' : '解锁';
}

/** 单位：元；0 元直接写「免费」，避免「¥0.00」看起来像要付钱 */
function priceText(price: number): string {
  return price === 0 ? '免费' : `¥${price.toFixed(2)}`;
}

/** 「买它得到什么」：按权益类型给说明，与商品名无关故由端上承载 */
function benefitText(product: ProductView): string {
  return product.benefits
    .map((benefit) => BENEFIT_DESCRIPTIONS[benefit.type] ?? BENEFIT_FALLBACK_DESCRIPTION)
    .join(' · ');
}

/** 权益记录里的商品名：商品下架后不在在售列表里，回退为通用文案而非裸编码 */
function entitlementName(productCode: string): string {
  return productNameMap.value[productCode] ?? '已解锁的内容';
}

function sourceLabel(source: string): string {
  return ENTITLEMENT_SOURCE_LABELS[source] ?? ENTITLEMENT_SOURCE_FALLBACK_LABEL;
}

// ------------------------------------------------------------------ 领取

async function handleClaim(product: ProductView): Promise<void> {
  if (claimingCode.value) return;
  claimingCode.value = product.code;
  try {
    const result = await paymentApi.createOrder(product.code);
    if (!result.settled) {
      // P1（PAYMENT_GATEWAY=free）恒为 settled；走到这里说明该商品需要真实支付（P2），
      // 端上调起支付的步骤尚未接入，订单已落库，故提示后可到「我的订单」查看
      uni.showToast({ title: '订单已创建，待支付完成后自动解锁', icon: 'none' });
      await load();
      return;
    }
    uni.showToast({ title: '已解锁，去看看吧', icon: 'none' });
    await load();
  } catch (error) {
    uni.showToast({
      title: error instanceof ApiError ? error.message : '领取失败，请稍后重试',
      icon: 'none',
    });
  } finally {
    claimingCode.value = '';
  }
}

// ------------------------------------------------------------------ 兑换码

async function handleRedeem(): Promise<void> {
  if (redeeming.value) return;
  // 码字符集是大写（去掉 0/O/1/I 等易混字符），用户手输小写也照常受理
  const code = couponCode.value.trim().toUpperCase();
  if (!code) {
    uni.showToast({ title: '请先输入兑换码', icon: 'none' });
    return;
  }

  redeeming.value = true;
  try {
    await paymentApi.redeemCoupon(code);
    couponCode.value = '';
    uni.showToast({ title: '兑换成功，权益已到账', icon: 'none' });
    await load();
  } catch (error) {
    uni.showToast({ title: couponErrorText(error), icon: 'none' });
  } finally {
    redeeming.value = false;
  }
}

/** 兑换失败按错误码给**可操作**的文案（§14.9：核对重试 / 联系客服 / 换新码） */
function couponErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === ApiErrorCode.COUPON_INVALID) return '兑换码无效，请核对后重试';
    if (error.code === ApiErrorCode.COUPON_USED) return '该兑换码已被使用，请联系客服';
    if (error.code === ApiErrorCode.COUPON_EXPIRED) return '该兑换码已过期，请联系客服换新码';
    return error.message;
  }
  return '兑换失败，请稍后重试';
}

// ------------------------------------------------------------------ 恢复购买

async function handleRestore(): Promise<void> {
  if (restoring.value) return;
  restoring.value = true;
  try {
    const order = await paymentApi.restorePurchase();
    if (!order) {
      uni.showToast({ title: '没有待处理的订单', icon: 'none' });
      return;
    }
    if (!order.recovered) {
      // free / mock 网关没有外部账单可查（supportsQuery = false），只返回本地状态，绝不伪造「已支付」
      uni.showToast({ title: `订单当前状态：${statusLabel(order.status)}`, icon: 'none' });
      return;
    }
    uni.showToast({ title: '已补单成功，权益已到账', icon: 'none' });
    await load();
  } catch (error) {
    uni.showToast({
      title: error instanceof ApiError ? error.message : '操作失败，请稍后重试',
      icon: 'none',
    });
  } finally {
    restoring.value = false;
  }
}

// ------------------------------------------------------------------ 订单

function statusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? ORDER_STATUS_FALLBACK_LABEL;
}

/** 已到账看付款时间；未到账看支付截止（E3：创建后 30 分钟关闭） */
function orderTimeText(order: OrderDetailView): string {
  return order.paidAt ? `到账 ${formatDate(order.paidAt)}` : `支付截止 ${formatDate(order.expireAt)}`;
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="placeholder">正在加载…</view>

    <view v-else-if="errorText" class="placeholder">
      <view class="placeholder__text">{{ errorText }}</view>
      <button class="action" @tap="load">重新加载</button>
    </view>

    <template v-else>
      <!-- 权益概览：解锁态全部来自服务端 -->
      <view class="card">
        <view class="card__title">我的权益</view>
        <view class="row">
          <text class="row__label">双人对比报告</text>
          <text class="row__value">{{ summary?.doubleReport ? OWNED_BADGE : '未解锁' }}</text>
        </view>
        <view class="row">
          <text class="row__label">议题全包</text>
          <text class="row__value">{{ summary?.topicBundle ? '已拥有' : '未拥有' }}</text>
        </view>
        <view class="row">
          <text class="row__label">已解锁议题</text>
          <text class="row__value">{{ topicCount }} 个</text>
        </view>

        <view v-if="records.length > 0" class="records">
          <view v-for="item in records" :key="item.id" class="record">
            <text class="record__name">{{ entitlementName(item.productCode) }}</text>
            <text class="record__meta">{{ sourceLabel(item.source) }} · {{ formatDate(item.grantedAt) }}</text>
          </view>
        </view>
      </view>

      <!-- 可解锁的内容：价格与是否可领都由服务端下发（E4 / ADR-009 决策 1） -->
      <view class="card">
        <view class="card__title">可解锁的内容</view>

        <view v-if="products.length === 0" class="hint">暂时没有可解锁的内容</view>

        <view v-for="product in products" :key="product.code" class="product">
          <view class="product__head">
            <text class="product__name">{{ product.name }}</text>
            <text class="product__price">{{ priceText(product.price) }}</text>
          </view>
          <view class="product__desc">{{ benefitText(product) }}</view>

          <text v-if="isOwned(product)" class="badge">{{ OWNED_BADGE }}</text>
          <button
            v-else-if="canClaim(product)"
            class="action"
            :loading="claimingCode === product.code"
            :disabled="!!claimingCode"
            @tap="handleClaim(product)"
          >
            {{ claimActionLabel(product) }}
          </button>
          <view v-else class="product__hint">{{ IOS_PURCHASE_BLOCKED_HINT }}</view>
        </view>
      </view>

      <!-- 兑换码：iOS 过渡路径（§4 / E8） -->
      <view class="card">
        <view class="card__title">兑换码</view>
        <view class="hint">输入客服发放的兑换码，即可解锁对应内容</view>
        <view class="coupon">
          <input
            v-model="couponCode"
            class="coupon__input"
            type="text"
            placeholder="输入兑换码"
            placeholder-class="coupon__placeholder"
          />
          <button class="action action--inline" :loading="redeeming" :disabled="redeeming" @tap="handleRedeem">
            兑换
          </button>
        </view>
      </view>

      <!-- 恢复购买：E1 漏单兜底 -->
      <view class="card">
        <view class="card__title">恢复购买</view>
        <view class="hint">{{ RESTORE_HINT }}</view>
        <button class="action action--ghost" :loading="restoring" :disabled="restoring" @tap="handleRestore">
          恢复购买
        </button>
      </view>

      <!-- 我的订单：作为「我解锁了什么」的凭据 -->
      <view class="card">
        <view class="card__title">我的订单</view>
        <view v-if="orders.length === 0" class="hint">还没有订单</view>
        <view v-for="order in orders" :key="order.outTradeNo" class="order">
          <view class="order__head">
            <text class="order__name">{{ order.productName }}</text>
            <text class="order__amount">{{ priceText(order.amount) }}</text>
          </view>
          <view class="order__meta">{{ statusLabel(order.status) }} · {{ orderTimeText(order) }}</view>
        </view>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 32rpx;
  background-color: $zb-color-bg;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 200rpx;
  text-align: center;

  &__text {
    margin-bottom: 24rpx;
    color: $zb-color-text-secondary;
  }
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

.row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12rpx;

  &__label {
    color: $zb-color-text-secondary;
  }

  &__value {
    font-weight: 600;
  }
}

.records {
  padding-top: 16rpx;
  margin-top: 16rpx;
  border-top: 1rpx solid rgba(138, 128, 120, 0.15);
}

.record {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12rpx;

  &__name {
    max-width: 60%;
    font-size: $zb-font-size-base;
  }

  &__meta {
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }
}

.product {
  padding: 24rpx 0;
  border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

  &:last-child {
    border-bottom: none;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__name {
    font-size: $zb-font-size-base;
    font-weight: 600;
  }

  &__price {
    color: $zb-color-primary;
  }

  &__desc {
    margin-top: 8rpx;
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }

  &__hint {
    margin-top: 16rpx;
    font-size: 24rpx;
    color: $zb-color-warning;
  }
}

.badge {
  display: inline-block;
  padding: 4rpx 16rpx;
  margin-top: 16rpx;
  font-size: 22rpx;
  color: $zb-color-success;
  background-color: rgba(76, 154, 106, 0.12);
  border-radius: 999rpx;
}

.coupon {
  display: flex;
  align-items: center;
  margin-top: 16rpx;

  &__input {
    flex: 1;
    height: 80rpx;
    padding: 0 24rpx;
    font-size: $zb-font-size-base;
    background-color: $zb-color-bg;
    border-radius: $zb-radius-card;
    box-sizing: border-box;
  }

  &__placeholder {
    color: $zb-color-text-secondary;
  }
}

.order {
  padding: 24rpx 0;
  border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

  &:last-child {
    border-bottom: none;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__name {
    font-size: $zb-font-size-base;
    font-weight: 600;
  }

  &__amount {
    color: $zb-color-primary;
  }

  &__meta {
    margin-top: 8rpx;
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }
}

.hint {
  font-size: 24rpx;
  color: $zb-color-text-secondary;
}

.action {
  margin-top: 24rpx;
  color: $zb-color-surface;
  background-color: $zb-color-primary;

  &:active {
    background-color: $zb-color-primary-dark;
  }

  &--ghost {
    color: $zb-color-text-secondary;
    background-color: transparent;
  }

  &--inline {
    width: 160rpx;
    margin-top: 0;
    margin-left: 16rpx;
  }

  &::after {
    border: none;
  }
}
</style>
