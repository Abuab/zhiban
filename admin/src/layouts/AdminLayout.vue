<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Document, Setting } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { useBrandStore } from '@/stores/brand';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const brandStore = useBrandStore();

/** 当前高亮菜单项（与路由路径一致） */
const activeMenu = computed(() => route.path);

/** 当前登录账号 */
const username = computed(() => authStore.profile?.username ?? '');

/** 退出登录后回到登录页 */
async function handleLogout(): Promise<void> {
  await authStore.logout();
  ElMessage.success('已退出登录');
  await router.replace({ path: '/login' });
}
</script>

<template>
  <el-container class="admin-layout">
    <el-aside width="220px" class="admin-aside">
      <div class="admin-aside__brand">{{ brandStore.brandName }}</div>
      <el-menu :default-active="activeMenu" router class="admin-menu">
        <el-sub-menu index="settings">
          <template #title>
            <el-icon><Setting /></el-icon>
            <span>系统设置</span>
          </template>
          <el-menu-item index="/settings/brand-site">
            <el-icon><Document /></el-icon>
            <span>品牌与站点</span>
          </el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="admin-header">
        <div class="admin-header__title">{{ brandStore.brandName }}</div>
        <div class="admin-header__user">
          <span class="admin-header__username">{{ username }}</span>
          <el-button link type="primary" @click="handleLogout">退出登录</el-button>
        </div>
      </el-header>

      <el-main class="admin-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.admin-layout {
  height: 100vh;
}

.admin-aside {
  border-right: 1px solid var(--el-border-color-light);
  background-color: #ffffff;
}

.admin-aside__brand {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  border-bottom: 1px solid var(--el-border-color-light);
}

.admin-menu {
  border-right: none;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--el-border-color-light);
  background-color: #ffffff;
}

.admin-header__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.admin-header__user {
  display: flex;
  align-items: center;
  gap: 12px;
}

.admin-header__username {
  color: var(--el-text-color-regular);
}

.admin-main {
  background-color: #f5f7fa;
}
</style>
