<template>
  <div class="not-found-view">
    <el-result
      icon="error"
      :title="$t('error.notFound.title')"
      :sub-title="$t('error.notFound.message')"
    >
      <template #extra>
        <el-button type="primary" @click="$router.push('/dashboard')">
          {{ $t('error.notFound.backToDashboard') }}
        </el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped>
.not-found-view {
  padding: 50px 20px;
  text-align: center;
}
</style>