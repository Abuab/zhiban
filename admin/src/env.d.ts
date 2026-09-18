/// <reference types="vite/client" />

/** 环境变量类型声明（仅接口前缀与本地代理地址，不含任何密钥） */
interface ImportMetaEnv {
  /** 接口前缀，例如 /api */
  readonly VITE_API_BASE_URL: string;
  /** 本地开发时 Vite 代理的后端地址（仅 dev 生效） */
  readonly VITE_DEV_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
