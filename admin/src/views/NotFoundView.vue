<script setup lang="ts">
import { useRouter } from 'vue-router';
import { HOME_PATH } from '@/router';

const router = useRouter();
</script>

<template>
  <el-result icon="warning" title="404" sub-title="页面不存在或已被移除">
    <template #extra>
      <el-button type="primary" @click="router.replace({ path: HOME_PATH })">返回首页</el-button>
    </template>
  </el-result>
</template>
