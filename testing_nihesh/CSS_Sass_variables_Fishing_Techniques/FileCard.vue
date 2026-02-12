<template>
  <div class="file-card" @click="$emit('select', file)">
    <div class="file-icon">
      <component :is="iconComponent" />
    </div>
    <div class="file-info">
      <h3 class="file-name">{{ file.filename }}</h3>
      <p class="file-summary">{{ truncatedSummary }}</p>
      <div class="file-meta">
        <span class="file-type">{{ file.file_type }}</span>
        <span class="file-size">{{ formatSize(file.size_bytes) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface FileInfo {
  id: number;
  filename: string;
  file_type: string;
  size_bytes: number;
  summary: string;
}

const props = defineProps<{ file: FileInfo }>();
defineEmits<{ select: [file: FileInfo] }>();

const truncatedSummary = computed(() =>
  props.file.summary.length > 120
    ? props.file.summary.slice(0, 120) + '...'
    : props.file.summary
);

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
</script>

<style scoped>
.file-card {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}
.file-card:hover { background: rgba(255, 255, 255, 0.05); }
.file-name { font-weight: 600; }
.file-meta { display: flex; gap: 0.5rem; opacity: 0.6; font-size: 0.875rem; }
</style>
