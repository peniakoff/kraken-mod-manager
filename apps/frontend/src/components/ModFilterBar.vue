<script setup lang="ts">
import { POPULAR_MOD_TAGS } from "../modTags.js";

defineProps<{
  selectedTag: string;
  customTag: string;
  compatibleOnly: boolean;
  kspVersion?: string;
  disabled: boolean;
}>();

const emit = defineEmits<{
  "update:selectedTag": [value: string];
  "update:customTag": [value: string];
  "update:compatibleOnly": [value: boolean];
  resetFilters: [];
}>();
</script>

<template>
  <div class="mt-4 space-y-3 rounded-lg border border-slate-700 p-3">
    <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Category filter">
      <span class="text-sm font-medium text-slate-300">Category:</span>
      <button
        v-for="tag in POPULAR_MOD_TAGS"
        :key="tag"
        type="button"
        :disabled="disabled"
        :aria-pressed="selectedTag.toLowerCase() === tag.toLowerCase()"
        :class="[
          'rounded-full border px-3 py-1 text-sm font-medium disabled:opacity-60',
          selectedTag.toLowerCase() === tag.toLowerCase()
            ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
            : 'border-slate-600 text-slate-300 hover:bg-slate-800',
        ]"
        @click="emit('update:selectedTag', selectedTag.toLowerCase() === tag.toLowerCase() ? '' : tag)"
      >
        {{ tag }}
      </button>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div class="min-w-44 flex-1">
        <label class="block text-sm font-medium text-slate-300" for="mod-tag">Custom tag</label>
        <input
          id="mod-tag"
          class="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
          type="text"
          placeholder="e.g. tech-tree"
          maxlength="128"
          :value="customTag"
          :disabled="disabled"
          @input="emit('update:customTag', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input
          id="compatible-only"
          type="checkbox"
          class="h-4 w-4 accent-cyan-500"
          :checked="compatibleOnly"
          :disabled="disabled"
          @change="emit('update:compatibleOnly', ($event.target as HTMLInputElement).checked)"
        />
        <span>
          Compatible only
          <span v-if="kspVersion" class="font-mono text-slate-400">{{ kspVersion }}</span>
        </span>
      </label>
      <button
        class="rounded-md border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
        type="button"
        :disabled="disabled"
        @click="emit('resetFilters')"
      >
        Reset filters
      </button>
    </div>
  </div>
</template>
