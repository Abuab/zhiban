<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import QRCode from 'qrcode';
import { enableTotp, setupTotp } from '@/api/auth';
import { ApiError, ApiErrorCode, showError } from '@/api/http';
import { HOME_PATH } from '@/router';
import { useAuthStore } from '@/stores/auth';
import { useBrandStore } from '@/stores/brand';

const router = useRouter();
const authStore = useAuthStore();
const brandStore = useBrandStore();

const loading = ref(false);
const submitting = ref(false);
const qrDataUrl = ref('');
const secret = ref('');
const code = ref('');

/**
 * 获取（或重新生成）二次验证密钥并渲染二维码
 * 服务端在 setup 阶段不落库，只有提交动态码校验通过后才真正绑定
 */
async function loadSecret(): Promise<void> {
  loading.value = true;
  try {
    const result = await setupTotp();
    secret.value = result.secret;
    qrDataUrl.value = await QRCode.toDataURL(result.otpauthUrl, { width: 220, margin: 1 });
  } catch (error) {
    // 已绑定过则无需重复绑定，刷新资料后回首页
    if (error instanceof ApiError && error.code === ApiErrorCode.ADMIN_TOTP_ALREADY_ENABLED) {
      await authStore.fetchProfile().catch(() => undefined);
      ElMessage.info('二次验证已绑定');
      await router.replace({ path: HOME_PATH });
      return;
    }
    showError(error);
  } finally {
    loading.value = false;
  }
}

/** 提交动态码完成绑定 */
async function handleEnable(): Promise<void> {
  if (!/^\d{6}$/.test(code.value)) {
    ElMessage.error('请输入 6 位动态码');
    return;
  }

  submitting.value = true;
  try {
    await enableTotp(code.value);
    await authStore.fetchProfile();
    ElMessage.success('二次验证绑定成功');
    await router.replace({ path: HOME_PATH });
  } catch (error) {
    showError(error);
  } finally {
    submitting.value = false;
  }
}

onMounted(loadSecret);
</script>

<template>
  <div class="totp-page">
    <el-card class="totp-card" shadow="always" v-loading="loading">
      <div class="totp-card__header">
        <h1 class="totp-card__title">{{ brandStore.pageTitle }}</h1>
        <p class="totp-card__subtitle">首次登录需绑定二次验证（动态口令）</p>
      </div>

      <el-steps :active="1" simple class="totp-card__steps">
        <el-step title="使用验证器扫描二维码" />
        <el-step title="输入动态码完成绑定" />
      </el-steps>

      <div class="totp-card__qrcode">
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="二次验证二维码" class="totp-card__qrcode-img" />
        <el-empty v-else description="二维码加载中" />
      </div>

      <el-form label-position="top">
        <el-form-item label="密钥（扫码失败可手动录入此密钥）">
          <el-input :model-value="secret" readonly />
        </el-form-item>

        <el-form-item label="动态码">
          <el-input
            v-model="code"
            maxlength="6"
            placeholder="请输入验证器上的 6 位数字"
            @keyup.enter="handleEnable"
          />
        </el-form-item>
      </el-form>

      <div class="totp-card__actions">
        <el-button :loading="loading" @click="loadSecret">重新生成密钥</el-button>
        <el-button type="primary" :loading="submitting" @click="handleEnable">完成绑定</el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.totp-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f5f7fa;
  padding: 24px 0;
}

.totp-card {
  width: 420px;
}

.totp-card__header {
  text-align: center;
  margin-bottom: 16px;
}

.totp-card__title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.totp-card__subtitle {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.totp-card__steps {
  margin-bottom: 16px;
}

.totp-card__qrcode {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}

.totp-card__qrcode-img {
  width: 220px;
  height: 220px;
}

.totp-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
