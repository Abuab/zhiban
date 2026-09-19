<script setup lang="ts">
/**
 * 雷达图（简版报告 / 双人对比报告）
 *
 * 规格依据：宪法 L520-522「单人测评 + 简版报告免费，内容 = 8 维度答题 + 雷达图 + 一句话点评」
 *   《价值感与内容标准》§二.3：报告生成 = 雷达图逐维度点亮动画（≤2 秒，可跳过）
 *   PRD-002 R3：L1 完整版含「双人雷达图」，故同一组件支持叠加第二条数据系列（`itemsB`）
 *
 * 实现说明：
 *   1. 用微信小程序的 canvas 2d（`type="2d"`）绘制，按 dpr 缩放保证高清；
 *   2. 画布内只画网格 + 折线多边形 + 第一系列的顶点分值，**维度名放画布外的图例**——
 *      8 个中文维度名较长，画在顶点必然重叠，图例可读性更好且不牺牲图形；
 *   3. 未评估维度（B7 拒绝授权，score = null）不参与绘制，图例中单独标注「未评估」；
 *   4. 绘制失败（低版本基础库 / 节点未就绪）只告警，不影响报告正文展示（A5 不出现死页）。
 *
 * 双系列约定（模块 5）：`itemsB` 与 `items` **按下标一一对应**（同一份量表、同一维度顺序），
 *   两条系列使用不同颜色 + 图例双色标记；顶点数字只标第一系列，避免两点重合时数字叠字。
 */
import { getCurrentInstance, onMounted, watch } from 'vue';
import type { RadarItem } from '../../types/assessment';

const props = withDefaults(
  defineProps<{
    items: RadarItem[];
    /** 第二条数据系列（双人对比报告用）；与 items 下标对齐，传 null 为单系列 */
    itemsB?: RadarItem[] | null;
    /** 双系列的图例名（如「阿泽」「小满」），单系列不需要 */
    seriesLabels?: { a: string; b: string } | null;
    /** 画布逻辑尺寸（px），默认按屏宽适配由父级传入 */
    size?: number;
    /** 是否播放逐维度点亮动画 */
    animate?: boolean;
  }>(),
  { itemsB: null, seriesLabels: null, size: 260, animate: true },
);

/** 分值区间（与后端维度分口径一致：0-100） */
const SCORE_MIN = 0;
const SCORE_MAX = 100;
/** 网格层数 */
const GRID_LEVELS = 4;
/** 动画时长（毫秒），规格要求 ≤2 秒 */
const ANIMATION_MS = 1200;
/** 动画帧间隔 */
const FRAME_MS = 40;

const COLOR_PRIMARY = '#E8734A';
/** 第二条系列：中性冷色，避免被读成「好/坏」的评价（两位参与者是并列关系，不是优劣关系） */
const COLOR_SERIES_B = '#6E8CA8';
const COLOR_GRID = '#E8DFD6';
const COLOR_AXIS = '#D9CFC4';
const COLOR_TEXT = '#8A8078';

const instance = getCurrentInstance();

/**
 * 微信小程序 canvas 2d 节点
 * @dcloudio/types 未导出该类型（仅 canvas-id 旧接口有完整类型），故按实际使用面声明最小结构
 */
interface CanvasNodeLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D;
}

/**
 * selector query 的最小结构
 * 原因：@dcloudio/types 的 `fields` 签名是 `fields(fields, callback)`（旧版 uni 接口），
 *   无法表达小程序 2d canvas 的标准链式写法 `fields({node,size}).exec(cb)`，
 *   故此处按运行时真实行为声明，避免为一个类型缺口改用已废弃的 createCanvasContext。
 */
interface NodeQueryLike {
  in(component: unknown): NodeQueryLike;
  select(selector: string): NodeQueryLike;
  fields(options: { node?: boolean; size?: boolean }, callback?: (result: unknown) => void): NodeQueryLike;
  exec(callback: (result: Array<{ node?: CanvasNodeLike; width?: number }>) => void): void;
}

let canvasSize = 0;
let renderingContext: CanvasRenderingContext2D | null = null;
let frameTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 参与绘制的维度（剔除未评估项）
 * 返回时保留原始下标，便于按同下标取第二条系列（两条系列维度顺序一致）
 */
function drawablePairs(): Array<{ a: RadarItem; b: RadarItem | null }> {
  const listB = props.itemsB;
  const hasB = listB !== null && Array.isArray(listB) && listB.length === props.items.length;
  const pairs: Array<{ a: RadarItem; b: RadarItem | null }> = [];
  props.items.forEach((item, index) => {
    if (typeof item.value !== 'number') return;
    pairs.push({ a: item, b: hasB ? listB[index] : null });
  });
  return pairs;
}

function clearTimer(): void {
  if (frameTimer !== null) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
}

/** 准备画布：取节点、按 dpr 设置物理像素 */
function setupCanvas(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!instance) {
      resolve(false);
      return;
    }
    const query = (uni.createSelectorQuery() as unknown as NodeQueryLike).in(instance.proxy);
    query
      .select('#radar-canvas')
      .fields({ node: true, size: true })
      .exec((result) => {
        const first = result?.[0];
        const node = first?.node;
        if (!node) {
          resolve(false);
          return;
        }
        const width = first?.width || props.size;
        const dpr = uni.getSystemInfoSync().pixelRatio || 1;
        node.width = width * dpr;
        node.height = width * dpr;
        const context = node.getContext('2d');
        context.scale(dpr, dpr);
        renderingContext = context;
        canvasSize = width;
        resolve(true);
      });
  });
}

/** 计算第 index 个轴在给定半径下的端点坐标（从正上方开始，顺时针分布） */
function axisPoint(index: number, count: number, radius: number): { x: number; y: number } {
  const center = canvasSize / 2;
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
  return { x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius };
}

/** 分值 → 半径（线性映射到 0-100） */
function valueRadius(value: number, maxRadius: number): number {
  const ratio = (value - SCORE_MIN) / (SCORE_MAX - SCORE_MIN);
  return maxRadius * Math.min(1, Math.max(0, ratio));
}

/** 绘制一帧；progress ∈ [0,1] 控制数据多边形的展开程度（点亮动画） */
function draw(progress: number): void {
  const context = renderingContext;
  if (!context) return;

  const pairs = drawablePairs();
  const count = pairs.length;
  const center = canvasSize / 2;
  const maxRadius = canvasSize / 2 - 24;

  context.clearRect(0, 0, canvasSize, canvasSize);
  if (count < 3) return;

  // 网格（由外向内）
  context.lineWidth = 1;
  context.strokeStyle = COLOR_GRID;
  for (let level = GRID_LEVELS; level >= 1; level -= 1) {
    const radius = (maxRadius * level) / GRID_LEVELS;
    context.beginPath();
    for (let index = 0; index < count; index += 1) {
      const point = axisPoint(index, count, radius);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.stroke();
  }

  // 轴线
  context.strokeStyle = COLOR_AXIS;
  for (let index = 0; index < count; index += 1) {
    const point = axisPoint(index, count, maxRadius);
    context.beginPath();
    context.moveTo(center, center);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  // 第二条系列（双人对比）：先画 B 再画 A，保证第一系列（本人）压在更上层可辨识
  if (pairs.some((pair) => pair.b && typeof pair.b.value === 'number')) {
    drawSeries(context, pairs.map((pair) => pair.b?.value ?? null), count, maxRadius, progress, {
      fill: 'rgba(110, 140, 168, 0.18)',
      stroke: COLOR_SERIES_B,
    });
  }

  // 第一条系列（单系列时即唯一数据）
  drawSeries(context, pairs.map((pair) => pair.a.value), count, maxRadius, progress, {
    fill: 'rgba(232, 115, 74, 0.22)',
    stroke: COLOR_PRIMARY,
  });

  if (progress < 1) return;

  // 顶点分值（只标第一系列：两条系列分值经常接近，都标会叠字；
  // 画布内也只放数字，维度名放图例，避免长中文互相重叠）
  context.font = '11px sans-serif';
  context.fillStyle = COLOR_TEXT;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let index = 0; index < count; index += 1) {
    const value = pairs[index].a.value;
    if (typeof value !== 'number') continue;
    const radius = valueRadius(value, maxRadius) + 12;
    const point = axisPoint(index, count, radius);
    context.fillText(String(value), point.x, point.y);
  }
}

/**
 * 画一条数据系列的多边形
 * @param values 与轴顺序对齐的分值；未评估（null）处按 0 处理（该维度一般不参与绘制）
 */
function drawSeries(
  context: CanvasRenderingContext2D,
  values: Array<number | string | null>,
  count: number,
  maxRadius: number,
  progress: number,
  color: { fill: string; stroke: string },
): void {
  context.beginPath();
  for (let index = 0; index < count; index += 1) {
    const raw = values[index];
    const value = typeof raw === 'number' ? raw : 0;
    const radius = valueRadius(value, maxRadius) * progress;
    const point = axisPoint(index, count, radius);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.fillStyle = color.fill;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = color.stroke;
  context.stroke();
}

/** 逐维度点亮动画；animate=false 时直接画最终态 */
function render(): void {
  clearTimer();
  if (!props.animate) {
    draw(1);
    return;
  }
  const startAt = Date.now();
  frameTimer = setInterval(() => {
    const elapsed = Date.now() - startAt;
    const progress = Math.min(1, elapsed / ANIMATION_MS);
    draw(progress);
    if (progress >= 1) clearTimer();
  }, FRAME_MS);
}

async function init(): Promise<void> {
  try {
    const ready = await setupCanvas();
    if (!ready) {
      console.warn('[zhiban] 雷达图画布未就绪，报告正文不受影响');
      return;
    }
    render();
  } catch (error) {
    console.warn('[zhiban] 雷达图绘制失败，报告正文不受影响', error);
  }
}

onMounted(() => {
  void init();
});

// 报告数据（维度分）异步到达后重绘（两条系列任一变化都要重画）
watch(
  () => [
    props.items.map((item) => `${item.label}:${item.value ?? 'x'}`).join('|'),
    (props.itemsB ?? []).map((item) => `${item.value ?? 'x'}`).join('|'),
  ],
  () => {
    if (renderingContext) render();
  },
);

/** 图例中的分值文案：双系列时并列展示两方分数（未评估维度单独标注，不给 0 分，B7） */
function legendValue(index: number): string {
  const valueA = props.items[index]?.value;
  const textA = typeof valueA === 'number' ? String(valueA) : '未评估';
  const listB = props.itemsB;
  if (!listB || listB.length !== props.items.length) return textA;
  const valueB = listB[index]?.value;
  const textB = typeof valueB === 'number' ? String(valueB) : '未评估';
  return `${textA} / ${textB}`;
}

/** 是否渲染双系列图例（两条系列都齐备时才展示图例名，否则会被误解为只有一方数据） */
function hasSecondSeries(): boolean {
  const listB = props.itemsB;
  return listB !== null && Array.isArray(listB) && listB.length === props.items.length;
}

/** 供父组件在页面卸载时终止动画 */
defineExpose({ stop: clearTimer });
</script>

<template>
  <view class="radar">
    <canvas id="radar-canvas" canvas-id="radar-canvas" type="2d" class="radar__canvas" />
    <view v-if="hasSecondSeries() && seriesLabels" class="series">
      <view class="series__item">
        <view class="series__dot series__dot--a" />
        <text class="series__name">{{ seriesLabels.a }}</text>
      </view>
      <view class="series__item">
        <view class="series__dot series__dot--b" />
        <text class="series__name">{{ seriesLabels.b }}</text>
      </view>
    </view>
    <view class="legend">
      <view v-for="(item, index) in items" :key="item.label" class="legend__item">
        <text class="legend__label">{{ item.label }}</text>
        <text class="legend__value" :class="{ 'legend__value--muted': item.value === null }">
          {{ legendValue(index) }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.radar {
  display: flex;
  flex-direction: column;
  align-items: center;

  &__canvas {
    width: 520rpx;
    height: 520rpx;
  }
}

.series {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-top: 8rpx;

  &__item {
    display: flex;
    align-items: center;
    margin: 0 16rpx;
  }

  &__dot {
    width: 16rpx;
    height: 16rpx;
    margin-right: 8rpx;
    border-radius: 50%;

    &--a {
      background-color: #e8734a;
    }

    &--b {
      background-color: #6e8ca8;
    }
  }

  &__name {
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }
}

.legend {
  width: 100%;
  margin-top: 8rpx;

  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12rpx 0;
    border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);
  }

  &__label {
    font-size: 26rpx;
    color: $zb-color-text-secondary;
  }

  &__value {
    font-size: $zb-font-size-base;
    color: $zb-color-text;

    &--muted {
      color: $zb-color-text-secondary;
    }
  }
}
</style>
