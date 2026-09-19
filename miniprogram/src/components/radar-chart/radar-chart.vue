<script setup lang="ts">
/**
 * 雷达图（简版报告）
 *
 * 规格依据：宪法 L520-522「单人测评 + 简版报告免费，内容 = 8 维度答题 + 雷达图 + 一句话点评」
 *   《价值感与内容标准》§二.3：报告生成 = 雷达图逐维度点亮动画（≤2 秒，可跳过）
 *
 * 实现说明：
 *   1. 用微信小程序的 canvas 2d（`type="2d"`）绘制，按 dpr 缩放保证高清；
 *   2. 画布内只画网格 + 折线多边形 + 各顶点分值，**维度名放画布外的图例**——
 *      8 个中文维度名较长，画在顶点必然重叠，图例可读性更好且不牺牲图形；
 *   3. 未评估维度（B7 拒绝授权，score = null）不参与绘制，图例中单独标注「未评估」；
 *   4. 绘制失败（低版本基础库 / 节点未就绪）只告警，不影响报告正文展示（A5 不出现死页）。
 */
import { getCurrentInstance, onMounted, watch } from 'vue';
import type { RadarItem } from '../../types/assessment';

const props = withDefaults(
  defineProps<{
    items: RadarItem[];
    /** 画布逻辑尺寸（px），默认按屏宽适配由父级传入 */
    size?: number;
    /** 是否播放逐维度点亮动画 */
    animate?: boolean;
  }>(),
  { size: 260, animate: true },
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

/** 参与绘制的维度（剔除未评估项） */
function drawableItems(): RadarItem[] {
  return props.items.filter((item) => typeof item.value === 'number');
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

  const items = drawableItems();
  const count = items.length;
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

  // 数据多边形（按 progress 从圆心展开）
  context.beginPath();
  for (let index = 0; index < count; index += 1) {
    const value = items[index].value as number;
    const radius = valueRadius(value, maxRadius) * progress;
    const point = axisPoint(index, count, radius);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.fillStyle = 'rgba(232, 115, 74, 0.22)';
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = COLOR_PRIMARY;
  context.stroke();

  if (progress < 1) return;

  // 顶点分值（画布内只放数字，维度名放图例，避免长中文互相重叠）
  context.font = '11px sans-serif';
  context.fillStyle = COLOR_TEXT;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let index = 0; index < count; index += 1) {
    const item = items[index];
    const radius = valueRadius(item.value as number, maxRadius) + 12;
    const point = axisPoint(index, count, radius);
    context.fillText(String(item.value), point.x, point.y);
  }
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

// 报告数据（维度分）异步到达后重绘
watch(
  () => props.items.map((item) => `${item.label}:${item.value ?? 'x'}`).join('|'),
  () => {
    if (renderingContext) render();
  },
);

/** 供父组件在页面卸载时终止动画 */
defineExpose({ stop: clearTimer });
</script>

<template>
  <view class="radar">
    <canvas id="radar-canvas" canvas-id="radar-canvas" type="2d" class="radar__canvas" />
    <view class="legend">
      <view v-for="item in items" :key="item.label" class="legend__item">
        <text class="legend__label">{{ item.label }}</text>
        <text v-if="item.value === null" class="legend__value legend__value--muted">未评估</text>
        <text v-else class="legend__value">{{ item.value }}</text>
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
