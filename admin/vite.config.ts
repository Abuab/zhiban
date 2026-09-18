import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

/**
 * 构建配置
 * 说明：接口地址一律由 .env 的 VITE_API_BASE_URL 提供，此处不做任何硬编码；
 *      仅当配置了 VITE_DEV_PROXY_TARGET（本地联调后端）时才挂 dev 代理，生产构建不受影响。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = env.VITE_API_BASE_URL || '/api';
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET;

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: devProxyTarget
      ? {
          proxy: {
            [apiBaseUrl]: {
              target: devProxyTarget,
              changeOrigin: true,
              secure: true,
            },
          },
        }
      : undefined,
  };
});
