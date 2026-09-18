/// <reference types="vite/client" />

/** 环境变量类型声明（品牌配置在 .env 中定义，域名与模式在 .env.<mode> 中定义） */
interface ImportMetaEnv {
  readonly VITE_APP_ENV: 'development' | 'production';
  readonly VITE_API_BASE_URL: string;
  readonly VITE_BRAND_NAME: string;
  readonly VITE_BRAND_DESCRIPTION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
