<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadRequestOptions } from 'element-plus';
import { fetchConfigGroups, fetchConfigList, updateConfig, uploadImage } from '@/api/config';
import { showError } from '@/api/http';
import type {
  AdminConfigItem,
  ConfigGroup,
  ConfigValueType,
  UpdateConfigInput,
} from '@/types/api';

/** 分组筛选项「全部」的取值（空字符串表示不传 group 参数） */
const ALL_GROUP = '';

/** 后台上传图片的类型与体积约束（与服务端 admin-upload.service.ts 保持一致，仅作前置提示） */
const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg'];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** 值类型对应的标签样式与文案 */
const VALUE_TYPE_TAG: Record<ConfigValueType, 'primary' | 'success' | 'warning' | 'danger'> = {
  string: 'primary',
  number: 'success',
  boolean: 'warning',
  json: 'danger',
};

const VALUE_TYPE_LABEL: Record<ConfigValueType, string> = {
  string: '字符串',
  number: '数字',
  boolean: '布尔',
  json: 'JSON',
};

const loading = ref(false);
const items = ref<AdminConfigItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const group = ref<string>(ALL_GROUP);
const groups = ref<ConfigGroup[]>([]);

/** 弹窗状态 */
const dialogVisible = ref(false);
const saving = ref(false);
const editingItem = ref<AdminConfigItem | null>(null);
const form = reactive({
  configValue: '',
  isPublic: 0,
  description: '',
});
/** 图片上传中（仅用于上传按钮的 loading 反馈） */
const uploading = ref(false);

/** 加载配置分组（用于筛选下拉） */
async function loadGroups(): Promise<void> {
  try {
    groups.value = await fetchConfigGroups();
  } catch (error) {
    showError(error);
  }
}

/** 加载配置列表 */
async function loadList(): Promise<void> {
  loading.value = true;
  try {
    const result = await fetchConfigList({
      group: group.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    items.value = result.items;
    total.value = result.total;
    page.value = result.page;
    pageSize.value = result.pageSize;
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

function handleGroupChange(): void {
  page.value = 1;
  void loadList();
}

function handlePageChange(nextPage: number): void {
  page.value = nextPage;
  void loadList();
}

function handlePageSizeChange(nextSize: number): void {
  pageSize.value = nextSize;
  page.value = 1;
  void loadList();
}

/** 切换「是否公开」：直接落库，失败回滚开关并提示 */
async function handlePublicChange(row: AdminConfigItem, next: 0 | 1): Promise<void> {
  const previous = row.isPublic;
  if (previous === next) return;

  row.isPublic = next;
  try {
    const updated = await updateConfig(row.configKey, { isPublic: next });
    Object.assign(row, updated);
    ElMessage.success('已保存，小程序下次冷启动生效');
  } catch (error) {
    row.isPublic = previous;
    showError(error);
  }
}

/** 开关为受控展示（:model-value），需由事件回传新值 */
function onPublicSwitchChange(row: AdminConfigItem, value: string | number | boolean): void {
  void handlePublicChange(row, Number(value) === 1 ? 1 : 0);
}

/** 打开编辑弹窗 */
function openDialog(row: AdminConfigItem): void {
  editingItem.value = row;
  form.configValue = row.configValue;
  form.isPublic = row.isPublic;
  form.description = row.description ?? '';
  dialogVisible.value = true;
}

/** 弹窗内布尔型配置的开关联动（库中统一存字符串 'true' / 'false'） */
function handleDialogBooleanChange(value: string | number | boolean): void {
  form.configValue = value ? 'true' : 'false';
}

/**
 * 该配置项是否需要「上传图片」入口（ADR-010 决策 5）
 * 命中条件：值为字符串 **且** 键名以 `_url` 结尾（当前仅 support.qrcode_url）
 */
function isImageUrlItem(item: AdminConfigItem | null): boolean {
  return !!item && item.valueType === 'string' && item.configKey.endsWith('_url');
}

/** 上传前本地预校验（服务端仍会再校验一次，这里只是省一次无谓的往返） */
function beforeImageUpload(file: File): boolean {
  if (!IMAGE_CONTENT_TYPES.includes(file.type)) {
    ElMessage.error('仅支持 PNG / JPEG 格式的图片');
    return false;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    ElMessage.error('图片不能超过 2MB');
    return false;
  }
  return true;
}

/**
 * 自定义上传（Authorization 由 api/http 的请求拦截器统一带上）
 * 上传成功只把 url 回填到输入框，**仍需点「保存」才落库** —— 避免误传即生效，
 * 也保留「配置改动必留审计」的既有约束；失败必须给可见提示，不能静默。
 */
async function handleImageUpload(options: UploadRequestOptions): Promise<void> {
  uploading.value = true;
  try {
    const result = await uploadImage(options.file);
    form.configValue = result.url;
    ElMessage.success('上传成功，请点击「保存」使其生效');
  } catch (error) {
    showError(error);
    // 继续抛出：el-upload 会对返回的 Promise 调 onError，使上传状态正确收敛（避免一直 loading）
    throw error;
  } finally {
    uploading.value = false;
  }
}

/** 按 valueType 校验配置值，返回 null 表示合法 */
function validateValue(): string | null {
  const item = editingItem.value;
  if (!item) return null;

  const value = form.configValue.trim();
  if (item.valueType === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) {
    return '该配置项需要填写数字';
  }
  if (item.valueType === 'boolean' && !['true', 'false'].includes(value.toLowerCase())) {
    return '该配置项需要填写 true 或 false';
  }
  if (item.valueType === 'json') {
    try {
      JSON.parse(value);
    } catch {
      return '该配置项需要填写合法的 JSON';
    }
  }
  return null;
}

/** 保存弹窗内的修改：只提交发生变化的字段 */
async function handleSave(): Promise<void> {
  const item = editingItem.value;
  if (!item) return;

  const invalid = validateValue();
  if (invalid) {
    ElMessage.error(invalid);
    return;
  }

  const nextValue = item.valueType === 'string' ? form.configValue : form.configValue.trim();
  const nextDescription = form.description.trim();

  const payload: UpdateConfigInput = {};
  if (nextValue !== item.configValue) payload.configValue = nextValue;
  if (form.isPublic !== item.isPublic) payload.isPublic = form.isPublic === 1 ? 1 : 0;
  if (nextDescription !== (item.description ?? '')) payload.description = nextDescription;

  if (Object.keys(payload).length === 0) {
    ElMessage.info('配置内容没有变化');
    dialogVisible.value = false;
    return;
  }

  saving.value = true;
  try {
    const updated = await updateConfig(item.configKey, payload);
    const index = items.value.findIndex((row) => row.configKey === item.configKey);
    if (index >= 0) items.value[index] = updated;
    ElMessage.success('已保存，小程序下次冷启动生效');
    dialogVisible.value = false;
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

/** 格式化服务端返回的时间字符串 */
function formatTime(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number): string => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

onMounted(() => {
  void loadGroups();
  void loadList();
});
</script>

<template>
  <div class="brand-site">
    <div class="brand-site__header">
      <h2 class="brand-site__title">品牌与站点</h2>
      <div class="brand-site__actions">
        <el-select v-model="group" class="brand-site__group" @change="handleGroupChange">
          <el-option label="全部" :value="ALL_GROUP" />
          <el-option
            v-for="item in groups"
            :key="item.group"
            :label="`${item.group}（${item.count}）`"
            :value="item.group"
          />
        </el-select>
        <el-button :loading="loading" @click="loadList">刷新</el-button>
      </div>
    </div>

    <el-alert
      class="brand-site__notice"
      type="info"
      :closable="false"
      show-icon
      title="配置键由代码消费，本页只支持修改配置值、是否公开与说明，不支持新增或删除配置键。"
    />

    <el-table v-loading="loading" :data="items" row-key="id" border>
      <el-table-column prop="configKey" label="配置键" min-width="200" />
      <el-table-column prop="configValue" label="配置值" min-width="200" show-overflow-tooltip />
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag :type="VALUE_TYPE_TAG[row.valueType as ConfigValueType]" disable-transitions>
            {{ VALUE_TYPE_LABEL[row.valueType as ConfigValueType] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="是否公开" width="110">
        <template #default="{ row }">
          <el-switch
            :model-value="row.isPublic"
            :active-value="1"
            :inactive-value="0"
            @change="onPublicSwitchChange(row, $event)"
          />
        </template>
      </el-table-column>
      <el-table-column prop="description" label="说明" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ row.description || '-' }}</template>
      </el-table-column>
      <el-table-column label="更新时间" width="180">
        <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDialog(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="brand-site__pagination">
      <el-pagination
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="handlePageChange"
        @size-change="handlePageSizeChange"
      />
    </div>

    <el-dialog v-model="dialogVisible" title="编辑配置项" width="520px">
      <el-form label-position="top">
        <el-form-item label="配置键">
          <el-input :model-value="editingItem?.configKey" readonly />
        </el-form-item>

        <el-form-item label="配置值">
          <el-switch
            v-if="editingItem?.valueType === 'boolean'"
            :model-value="form.configValue === 'true'"
            @change="handleDialogBooleanChange"
          />
          <el-input
            v-else-if="editingItem?.valueType === 'json'"
            v-model="form.configValue"
            type="textarea"
            :rows="5"
            placeholder="请输入合法的 JSON"
          />
          <template v-else>
            <el-input
              v-model="form.configValue"
              :placeholder="editingItem?.valueType === 'number' ? '请输入数字' : '请输入配置值'"
            />
            <!-- `_url` 结尾的字符串项（如 support.qrcode_url）额外提供图片上传入口 -->
            <div v-if="isImageUrlItem(editingItem)" class="brand-site__upload">
              <el-upload
                :show-file-list="false"
                accept="image/png,image/jpeg"
                :before-upload="beforeImageUpload"
                :http-request="handleImageUpload"
              >
                <el-button :loading="uploading">上传图片</el-button>
              </el-upload>
              <span class="brand-site__upload-tip">
                上传成功后地址已填入输入框，仍需点击「保存」才生效（须为 https 图片地址）；也可直接粘贴外链
              </span>
            </div>
          </template>
        </el-form-item>

        <el-form-item label="是否公开">
          <el-switch v-model="form.isPublic" :active-value="1" :inactive-value="0" />
        </el-form-item>

        <el-form-item label="说明">
          <el-input v-model="form.description" maxlength="256" placeholder="请输入配置说明" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.brand-site__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.brand-site__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.brand-site__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-site__group {
  width: 200px;
}

.brand-site__notice {
  margin-bottom: 16px;
}

.brand-site__upload {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin-top: 8px;
}

.brand-site__upload-tip {
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.brand-site__pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
