import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { getToken } from '@/api/http';
import { useAuthStore } from '@/stores/auth';

/** 登录后的默认落点 */
export const HOME_PATH = '/settings/brand-site';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
  },
  {
    path: '/totp-bind',
    name: 'totp-bind',
    component: () => import('@/views/TotpBindView.vue'),
  },
  {
    path: '/',
    component: () => import('@/layouts/AdminLayout.vue'),
    redirect: HOME_PATH,
    children: [
      {
        path: 'settings/brand-site',
        name: 'brand-site',
        component: () => import('@/views/settings/BrandSiteView.vue'),
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();
  const token = getToken();

  // 已登录时不再展示登录页
  if (to.path === '/login') {
    return token ? { path: HOME_PATH } : true;
  }

  // 未登录一律回登录页
  if (!token) {
    return { path: '/login' };
  }

  // 有令牌但资料未就绪：先拉取资料，失败视为登录态失效
  if (!authStore.profile) {
    try {
      await authStore.fetchProfile();
    } catch {
      authStore.clear();
      return { path: '/login' };
    }
  }

  // 未绑定二次验证时强制去绑定页（绑定页自身放行，避免循环跳转）
  if (!authStore.isTotpBound && to.path !== '/totp-bind') {
    return { path: '/totp-bind' };
  }

  return true;
});

export default router;
