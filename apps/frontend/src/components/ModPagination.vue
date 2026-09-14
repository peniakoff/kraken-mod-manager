<script setup lang="ts">
import { computed } from "vue";

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
  <nav class="mt-4 flex flex-wrap items-center gap-3" aria-label="Mod search pages">
    <button
      class="rounded-md border border-slate-600 px-3 py-1 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
      type="button"
      :disabled="disabled || currentPage === 0"
      @click="emit('update:page', currentPage - 1)"
    >
      Previous
    </button>
    <p class="text-sm text-slate-400" aria-live="polite">
      Showing {{ rangeStart }}–{{ rangeEnd }} of {{ total }} · Page {{ currentPage + 1 }} of {{ pageCount }}
    </p>
    <button
      class="rounded-md border border-slate-600 px-3 py-1 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
      type="button"
      :disabled="disabled || currentPage + 1 >= pageCount"
      @click="emit('update:page', currentPage + 1)"
    >
      Next
    </button>
  </nav>
</template>
