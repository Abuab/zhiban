<script setup lang="ts">
/**
 * L3 分享长图页（模块 5）
 *
 * 规格依据：
 *   - PRD-002 R3：分享版由**发起方**生成、可勾选，默认仅含共识区
 *   - 规范增补 v0.2 §3.1：L3 = 可勾选内容的分享长图
 *   - 《价值感与内容标准》§二.5：分享卡片首图只出现正向文案，**不出现分数**
 *   - docs/adr/ADR-005.md 决策 4：服务端只下发素材，长图由**小程序端 canvas 合成**（P1 无对象存储）
 *
 * 关键实现约束：
 *   1. **素材全部来自服务端**（标题 / 共识区 / 结尾 / 水印 / 免责声明），本页不拼任何业务文案；
 *      L3 模板的负向占位符已由服务端 fail-closed 丢弃，端上拿不到分数类内容。
 *   2. 可勾选内容 = L1 的共识项（`consensusItems[].questionCode`），与 PRD-002 §7 的 `selectedBlocks` 语义一致；
 *      **不允许勾选为空**：服务端把「未传 / 空数组」视为「默认全量」，端上如果放行空选会与用户预期相反。
 *   3. 画布常驻但移出可视区（`left: -9999px`），导出的是临时文件路径，页面展示的是 `<image>` 预览。
 *   4. 绘制失败或保存失败都给明确出口（A5 不出现死页）：前者可重试，后者引导开启相册权限。
 */
import { computed, getCurrentInstance, ref } from 'vue';
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app';
import { inviteApi } from '../../api/invite';
import {
  INVITE_ACCEPT_PAGE_PATH,
  INVITE_CODE_PATTERN,
  REPORT_STATUS,
  SHARE_BLOCK,
  SHARE_IMAGE,
} from '../../constants/invite';
import type { DoubleReportL1View, DoubleReportL3Material, InviteReportView } from '../../types/invite';
import { brandName } from '../../stores/app-config';
import { ensureLogin } from '../../utils/auth';
import { ApiError } from '../../utils/request';

// ------------------------------------------------------------------ 画布绘制（纯函数，无响应式依赖）

/** 微信小程序 canvas 2d 节点（@dcloudio/types 未导出该类型，按实际使用面声明最小结构） */
interface CanvasNodeLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D;
}

/** selector query 最小结构（同 components/radar-chart：旧版 uni 接口签名无法表达 2d canvas 的链式写法） */
interface NodeQueryLike {
  in(component: unknown): NodeQueryLike;
  select(selector: string): NodeQueryLike;
  fields(options: { node?: boolean; size?: boolean }, callback?: (result: unknown) => void): NodeQueryLike;
  exec(callback: (result: Array<{ node?: CanvasNodeLike; width?: number }>) => void): void;
}

/** 一段文本（绘制前按宽度折行） */
interface Paragraph {
  text: string;
  font: string;
  color: string;
  align: 'left' | 'center';
  lineHeight: number;
  /** 段前额外间距（px） */
  gapBefore: number;
  /** 段落锚点：用于在标题结束后画装饰线；无锚点为 null */
  marker: 'titleEnd' | null;
}

/** 折行后的单行（坐标为画布逻辑像素） */
interface DrawLine {
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
  align: 'left' | 'center';
}

const COLOR_TEXT = '#2B2622';
const COLOR_MUTED = '#8A8078';
const COLOR_ACCENT = '#E8734A';

const FONT_TITLE = 'bold 44px sans-serif';
const FONT_TITLE_SUB = '26px sans-serif';
const FONT_SECTION = 'bold 30px sans-serif';
const FONT_BODY = '26px sans-serif';
const FONT_FOOTER = '20px sans-serif';

/** 取某个区块的渲染文本（区块可能被服务端 fail-closed 丢弃，缺失时返回空串） */
function blockText(material: DoubleReportL3Material, blockKey: string): string {
  return material.blocks.find((block) => block.blockKey === blockKey)?.text ?? '';
}

/** 按换行拆段（服务端模板里的换行即排版意图，空行丢弃） */
function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 组装排版段落：标题 → 共识区 → 结尾 → 水印与免责声明 */
function buildParagraphs(material: DoubleReportL3Material): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // 标题块（模板为「昵称A 与 昵称B / 我们认真聊了一次未来 / 日期」）：首行放大，其余作副文案
  const titleLines = splitLines(blockText(material, SHARE_BLOCK.TITLE));
  titleLines.forEach((text, index) => {
    const isMain = index === 0;
    paragraphs.push({
      text,
      font: isMain ? FONT_TITLE : FONT_TITLE_SUB,
      color: isMain ? COLOR_TEXT : COLOR_MUTED,
      align: 'center',
      lineHeight: isMain ? 66 : 44,
      gapBefore: isMain ? 24 : 10,
      marker: index === titleLines.length - 1 ? 'titleEnd' : null,
    });
  });

  // 共识区：首行是模板固定小标题，其余每行一条共识项（服务端已按勾选裁剪）
  const consensusLines = splitLines(blockText(material, SHARE_BLOCK.CONSENSUS));
  consensusLines.forEach((text, index) => {
    const isSectionTitle = index === 0;
    paragraphs.push({
      text,
      font: isSectionTitle ? FONT_SECTION : FONT_BODY,
      color: isSectionTitle ? COLOR_TEXT : COLOR_MUTED,
      align: 'left',
      lineHeight: isSectionTitle ? 48 : 44,
      gapBefore: isSectionTitle ? 56 : 18,
      marker: null,
    });
  });

  // 结尾正向引导
  const endingLines = splitLines(blockText(material, SHARE_BLOCK.ENDING));
  endingLines.forEach((text, index) => {
    paragraphs.push({
      text,
      font: FONT_BODY,
      color: COLOR_MUTED,
      align: 'left',
      lineHeight: 44,
      gapBefore: index === 0 ? 64 : 8,
      marker: null,
    });
  });

  // 页脚：水印（D3 溯源短哈希，端上只绘制）与免责声明
  paragraphs.push({
    text: material.watermark,
    font: FONT_FOOTER,
    color: COLOR_MUTED,
    align: 'center',
    lineHeight: 32,
    gapBefore: 72,
    marker: null,
  });
  paragraphs.push({
    text: material.disclaimer,
    font: FONT_FOOTER,
    color: COLOR_MUTED,
    align: 'center',
    lineHeight: 32,
    gapBefore: 12,
    marker: null,
  });

  return paragraphs;
}

/** 按宽度折行（中文逐字折行；`for...of` 按码点遍历，emoji 不会被拆开） */
function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  font: string,
  maxWidth: number,
): string[] {
  context.font = font;
  const lines: string[] = [];
  let current = '';
  for (const char of text) {
    const candidate = current + char;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/** 排版：折行并算出每行坐标与画布总高（高度超上限时截断，避免生成超大图导致保存失败） */
function layout(
  context: CanvasRenderingContext2D,
  paragraphs: Paragraph[],
): { lines: DrawLine[]; titleEndY: number | null; height: number } {
  const maxWidth = SHARE_IMAGE.WIDTH - SHARE_IMAGE.PADDING * 2;
  const lines: DrawLine[] = [];
  let cursorY = SHARE_IMAGE.PADDING;
  let titleEndY: number | null = null;

  for (const paragraph of paragraphs) {
    cursorY += paragraph.gapBefore;
    for (const text of wrapText(context, paragraph.text, paragraph.font, maxWidth)) {
      lines.push({
        text,
        x: paragraph.align === 'center' ? SHARE_IMAGE.WIDTH / 2 : SHARE_IMAGE.PADDING,
        y: cursorY + paragraph.lineHeight / 2,
        font: paragraph.font,
        color: paragraph.color,
        align: paragraph.align,
      });
      cursorY += paragraph.lineHeight;
    }
    if (paragraph.marker === 'titleEnd') titleEndY = cursorY;
  }

  const height = Math.ceil(cursorY + SHARE_IMAGE.PADDING);
  if (height > SHARE_IMAGE.MAX_HEIGHT) {
    console.warn('[zhiban] 分享长图内容超出高度上限，已按上限截断', height);
  }
  return { lines, titleEndY, height: Math.min(height, SHARE_IMAGE.MAX_HEIGHT) };
}

/** 绘制（背景 → 标题装饰线 → 全部文本） */
function paint(
  context: CanvasRenderingContext2D,
  measured: { lines: DrawLine[]; titleEndY: number | null; height: number },
): void {
  context.fillStyle = SHARE_IMAGE.BACKGROUND;
  context.fillRect(0, 0, SHARE_IMAGE.WIDTH, measured.height);

  // 标题下的短装饰线（纯视觉元素，不含任何分值/档位）
  if (measured.titleEndY !== null) {
    context.fillStyle = COLOR_ACCENT;
    context.fillRect(SHARE_IMAGE.WIDTH / 2 - 40, measured.titleEndY + 26, 80, 4);
  }

  context.textBaseline = 'middle';
  for (const line of measured.lines) {
    context.font = line.font;
    context.fillStyle = line.color;
    context.textAlign = line.align;
    context.fillText(line.text, line.x, line.y);
  }
}

/** 导出画布为临时图片路径（`type="2d"` 需传 canvas 实例而非 canvasId） */
function exportImage(node: CanvasNodeLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      canvas: node,
      fileType: 'png',
      quality: 1,
      success: (result: { tempFilePath?: string }) => {
        if (result?.tempFilePath) resolve(result.tempFilePath);
        else reject(new Error('图片导出失败，请重试'));
      },
      fail: () => reject(new Error('图片导出失败，请重试')),
    };
    // @dcloudio/types 的 legacy 声明要求 canvasId，而 2d canvas 的运行时契约是传 canvas 实例，故此处按运行时收窄
    uni.canvasToTempFilePath(options as unknown as UniNamespace.CanvasToTempFilePathOptions);
  });
}

// ------------------------------------------------------------------ 页面状态

const instance = getCurrentInstance();

const loading = ref(true);
const errorText = ref('');
const code = ref('');
const reportId = ref(0);
const report = ref<InviteReportView | null>(null);
/** 已勾选的共识项题号（默认全选 = PRD-002 R3「默认仅共识区」） */
const selected = ref<string[]>([]);
const generating = ref(false);
const saving = ref(false);
/** 生成后的临时图片路径（空串 = 尚未生成） */
const imagePath = ref('');

const l1 = computed<DoubleReportL1View | null>(() => {
  const current = report.value;
  return current && 'inviteId' in current && current.level === 'L1' ? current : null;
});

const consensusItems = computed(() => l1.value?.consensusItems ?? []);
const hasConsensus = computed(() => consensusItems.value.length > 0);

// ------------------------------------------------------------------ 生命周期

onLoad((options) => {
  const params = (options ?? {}) as Record<string, string>;
  const rawCode = (params.code ?? '').trim().toLowerCase();
  const parsedReportId = Number(params.reportId);

  if (!INVITE_CODE_PATTERN.test(rawCode) || !Number.isInteger(parsedReportId) || parsedReportId <= 0) {
    loading.value = false;
    errorText.value = '分享页参数不完整，请从报告页重新进入';
    return;
  }

  code.value = rawCode;
  reportId.value = parsedReportId;
  void load();
});

onShareAppMessage(() => ({
  title: `${brandName.value} · 邀请你一起做一份关系测评`,
  path: `${INVITE_ACCEPT_PAGE_PATH}?code=${code.value}`,
}));

async function load(): Promise<void> {
  errorText.value = '';

  const ready = await ensureLogin();
  if (!ready) {
    loading.value = false;
    return;
  }

  try {
    const result = await inviteApi.getReport(code.value);
    report.value = result;

    if (!l1.value) {
      // 非发起方 / 报告未就绪都在此收敛：入口显隐已由报告页控制，这里是直达链接的兜底
      errorText.value =
        result.status === REPORT_STATUS.READY ? '仅发起方可以生成分享长图' : result.message;
      return;
    }
    // 默认全选：与 PRD-002 R3「默认仅共识区全量」一致
    selected.value = l1.value.consensusItems.map((item) => item.questionCode);
  } catch (error) {
    errorText.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

// ------------------------------------------------------------------ 勾选

function isSelected(questionCode: string): boolean {
  return selected.value.includes(questionCode);
}

function toggle(questionCode: string): void {
  selected.value = isSelected(questionCode)
    ? selected.value.filter((item) => item !== questionCode)
    : [...selected.value, questionCode];
}

// ------------------------------------------------------------------ 生成 / 保存 / 分享

async function handleGenerate(): Promise<void> {
  if (generating.value) return;
  if (selected.value.length === 0) {
    uni.showToast({ title: '至少保留一项，长图才有内容', icon: 'none' });
    return;
  }

  generating.value = true;
  imagePath.value = '';
  try {
    const material = await inviteApi.shareMaterial(reportId.value, selected.value);
    imagePath.value = await composeImage(material);
  } catch (error) {
    uni.showToast({ title: describeError(error), icon: 'none' });
  } finally {
    generating.value = false;
  }
}

/** 取画布节点 → 排版 → 绘制 → 导出（`type="2d"` 必须先设物理像素再绘制） */
function composeImage(material: DoubleReportL3Material): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!instance) {
      reject(new Error('画布未就绪，请重试'));
      return;
    }
    const query = (uni.createSelectorQuery() as unknown as NodeQueryLike).in(instance.proxy);
    query
      .select('#share-canvas')
      .fields({ node: true, size: true })
      .exec((result) => {
        const node = result?.[0]?.node;
        if (!node) {
          reject(new Error('画布未就绪，请重试'));
          return;
        }
        try {
          const paragraphs = buildParagraphs(material);
          // 先测量（此时画布尺寸无关紧要），再按测得高度设置物理像素
          const measured = layout(node.getContext('2d'), paragraphs);
          const dpr = uni.getSystemInfoSync().pixelRatio || 1;
          node.width = SHARE_IMAGE.WIDTH * dpr;
          node.height = measured.height * dpr;
          // 设置尺寸会重置画布状态（含变换），故重新取 context 并缩放
          const context = node.getContext('2d');
          context.scale(dpr, dpr);
          paint(context, measured);
          exportImage(node).then(resolve).catch(reject);
        } catch (error) {
          console.warn('[zhiban] 分享长图绘制失败', error);
          reject(new Error('图片生成失败，请重试'));
        }
      });
  });
}

async function handleSave(): Promise<void> {
  const path = imagePath.value;
  if (!path || saving.value) return;

  saving.value = true;
  try {
    await saveToAlbum(path);
    uni.showToast({ title: '已保存到相册', icon: 'success' });
  } catch (error) {
    if (isAuthDenied(error)) {
      uni.showModal({
        title: '需要相册权限',
        content: '保存图片需要你授权「保存到相册」，是否前往设置开启？',
        confirmText: '去设置',
        success: (result) => {
          if (result.confirm) uni.openSetting({});
        },
      });
      return;
    }
    uni.showToast({ title: '保存失败，请重试', icon: 'none' });
  } finally {
    saving.value = false;
  }
}

function saveToAlbum(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (error) => reject(error),
    });
  });
}

/** 用户拒绝授权（errMsg 形如 `saveImageToPhotosAlbum:fail auth deny`） */
function isAuthDenied(error: unknown): boolean {
  const detail = error as UniApp.GeneralCallbackResult | undefined;
  return (detail?.errMsg ?? '').includes('auth');
}

function handleShare(): void {
  const path = imagePath.value;
  if (!path) return;
  if (typeof uni.showShareImageMenu !== 'function') {
    // 低版本基础库无该接口：降级为「保存到相册」的引导，不做静默失败
    uni.showToast({ title: '请先保存到相册，再从相册分享', icon: 'none' });
    return;
  }
  uni.showShareImageMenu({ path });
}

function handleRetry(): void {
  loading.value = true;
  void load();
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message || '操作失败，请重试';
  if (error instanceof Error && error.message) return error.message;
  return '操作失败，请重试';
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="placeholder">
      <text class="placeholder__text">正在准备…</text>
    </view>

    <!-- 加载失败 / 直达链接越权：可返回，不出现死页（A5） -->
    <view v-else-if="errorText" class="placeholder">
      <text class="placeholder__text">{{ errorText }}</text>
      <button v-if="code" class="action action--ghost" @tap="handleRetry">重试</button>
    </view>

    <template v-else>
      <view class="intro">
        长图只记录你们想法一致的部分，可自行勾选要放进去的内容（默认全选）。
      </view>

      <!-- 可勾选内容（PRD-002 R3）：仅共识项，不含分值 / 差值 / 分歧 -->
      <view v-if="hasConsensus" class="card">
        <view class="card__title">要放进长图的内容</view>
        <view
          v-for="item in consensusItems"
          :key="item.questionCode"
          class="pick"
          @tap="toggle(item.questionCode)"
        >
          <view class="pick__box" :class="{ 'pick__box--on': isSelected(item.questionCode) }">
            <text v-if="isSelected(item.questionCode)" class="pick__tick">✓</text>
          </view>
          <view class="pick__text">
            <view class="pick__q">{{ item.questionTitle }}</view>
            <view class="pick__a">{{ item.optionLabel }}</view>
          </view>
        </view>
      </view>
      <view v-else class="hint">你们这次没有作答一致的题目，暂时无法生成共识长图。</view>

      <button
        v-if="hasConsensus"
        class="action"
        :loading="generating"
        :disabled="generating"
        @tap="handleGenerate"
      >
        {{ imagePath ? '重新生成' : '生成分享长图' }}
      </button>

      <view v-if="imagePath" class="preview">
        <image class="preview__image" :src="imagePath" mode="widthFix" />
        <view class="preview__hint">长按图片可保存或转发</view>
      </view>

      <view v-if="imagePath" class="actions">
        <button class="action action--ghost" :loading="saving" :disabled="saving" @tap="handleSave">
          保存到相册
        </button>
        <button class="action" @tap="handleShare">分享给朋友</button>
      </view>
    </template>

    <!-- 画布常驻但移出可视区：导出的是临时文件，页面展示的是 <image> 预览 -->
    <canvas id="share-canvas" canvas-id="share-canvas" type="2d" class="canvas" />
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 32rpx;
  background-color: $zb-color-bg;
}

.canvas {
  position: fixed;
  top: 0;
  left: -9999px;
  width: 750px;
  height: 400px;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 200rpx;
  text-align: center;

  &__text {
    font-size: $zb-font-size-base;
    line-height: 1.7;
    color: $zb-color-text-secondary;
  }
}

.intro {
  margin-bottom: 24rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: $zb-color-text-secondary;
}

.card {
  padding: 32rpx;
  margin-bottom: 24rpx;
  background-color: $zb-color-surface;
  border-radius: $zb-radius-card;

  &__title {
    margin-bottom: 16rpx;
    font-size: 30rpx;
    font-weight: 600;
  }
}

.pick {
  display: flex;
  align-items: flex-start;
  padding: 20rpx 0;
  border-bottom: 1rpx solid rgba(138, 128, 120, 0.15);

  &:last-child {
    border-bottom: none;
  }

  &__box {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36rpx;
    height: 36rpx;
    margin: 4rpx 20rpx 0 0;
    border: 2rpx solid rgba(138, 128, 120, 0.5);
    border-radius: 8rpx;

    &--on {
      background-color: $zb-color-primary;
      border-color: $zb-color-primary;
    }
  }

  &__tick {
    font-size: 24rpx;
    line-height: 1;
    color: $zb-color-surface;
  }

  &__text {
    flex: 1;
  }

  &__q {
    font-size: $zb-font-size-base;
    color: $zb-color-text;
  }

  &__a {
    margin-top: 6rpx;
    font-size: 24rpx;
    color: $zb-color-success;
  }
}

.preview {
  margin-top: 32rpx;
  text-align: center;

  &__image {
    width: 100%;
    border-radius: $zb-radius-card;
  }

  &__hint {
    margin-top: 12rpx;
    font-size: 24rpx;
    color: $zb-color-text-secondary;
  }
}

.actions {
  display: flex;
  margin-top: 24rpx;
}

.hint {
  font-size: 26rpx;
  line-height: 1.7;
  color: $zb-color-text-secondary;
}

.action {
  margin-top: 16rpx;
  color: $zb-color-surface;
  background-color: $zb-color-primary;

  &:active {
    background-color: $zb-color-primary-dark;
  }

  &--ghost {
    margin-right: 16rpx;
    color: $zb-color-text-secondary;
    background-color: transparent;
  }

  &::after {
    border: none;
  }
}
</style>
