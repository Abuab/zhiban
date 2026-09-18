<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { showError } from '@/api/http';
import { HOME_PATH } from '@/router';
import { useAuthStore } from '@/stores/auth';
import { useBrandStore } from '@/stores/brand';

const router = useRouter();
const authStore = useAuthStore();
const brandStore = useBrandStore();

const formRef = ref<FormInstance>();
const submitting = ref(false);

/** 登录表单：动态码已绑定时必填，首次登录可留空 */
const form = reactive({
  username: '',
  password: '',
  totpCode: '',
});

const rules: FormRules<typeof form> = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入口令', trigger: 'blur' }],
  totpCode: [
    {
      validator: (_rule, value: string, callback) => {
        if (!value) {
          callback();
          return;
        }
        if (!/^\d{6}$/.test(value)) {
          callback(new Error('动态码为 6 位数字'));
          return;
        }
        callback();
      },
      trigger: 'blur',
    },
  ],
};

/** 提交登录：成功后按是否已绑定二次验证决定落点 */
async function handleSubmit(): Promise<void> {
  const formEl = formRef.value;
  if (!formEl) return;

  const valid = await formEl.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    const result = await authStore.login({
      username: form.username,
      password: form.password,
      totpCode: form.totpCode || undefined,
    });
    ElMessage.success('登录成功');
    await router.replace({ path: result.admin.totpEnabled ? HOME_PATH : '/totp-bind' });
  } catch (error) {
    showError(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <el-card class="login-card" shadow="always">
      <div class="login-card__header">
        <h1 class="login-card__title">{{ brandStore.pageTitle }}</h1>
        <p class="login-card__subtitle">请使用管理员账号登录</p>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="handleSubmit"
      >
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" placeholder="请输入账号" autocomplete="username" />
        </el-form-item>

        <el-form-item label="口令" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="请输入口令"
            autocomplete="current-password"
          />
        </el-form-item>

        <el-form-item label="动态码" prop="totpCode">
          <el-input
            v-model="form.totpCode"
            maxlength="6"
            placeholder="已绑定二次验证时必填，首次登录可留空"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" class="login-card__submit" :loading="submitting" @click="handleSubmit">
            登录
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f5f7fa;
}

.login-card {
  width: 380px;
}

.login-card__header {
  text-align: center;
  margin-bottom: 16px;
}

.login-card__title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.login-card__subtitle {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.login-card__submit {
  width: 100%;
}
</style>
