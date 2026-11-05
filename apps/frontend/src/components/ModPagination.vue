<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { formatCount } from "../format.js";

const props = defineProps<{
  total: number;
  limit: number;
  offset: number;
  disabled: boolean;
}>();

const emit = defineEmits<{
  "update:page": [page: number];
}>();

const currentPage = computed(() => Math.floor(props.offset / props.limit));
const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.limit)));
const rangeStart = computed(() => (props.total === 0 ? 0 : props.offset + 1));
const rangeEnd = computed(() => Math.min(props.total, props.offset + props.limit));
</script>

<template>
  <nav
    class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3"
    aria-label="Mod search pages"
  >
    <p class="readout text-[13px] text-muted" aria-live="polite">
      Showing {{ formatCount(rangeStart) }}–{{ formatCount(rangeEnd) }} of {{ formatCount(total) }} · Page
      {{ currentPage + 1 }} of {{ formatCount(pageCount) }}
    </p>
    <div class="flex gap-2">
      <button
        class="btn btn-secondary btn-sm"
        type="button"
        :disabled="disabled || currentPage === 0"
        @click="emit('update:page', currentPage - 1)"
      >
        <AppIcon name="chevron-left" />Previous
      </button>
      <button
        class="btn btn-secondary btn-sm"
        type="button"
        :disabled="disabled || currentPage + 1 >= pageCount"
        @click="emit('update:page', currentPage + 1)"
      >
        Next<AppIcon name="chevron-right" />
      </button>
    </div>
  </nav>
</template>
