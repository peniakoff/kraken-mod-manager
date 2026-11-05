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
  <div class="mt-4 space-y-4">
    <div class="flex flex-wrap items-center gap-2" role="group" aria-labelledby="category-filter-label">
      <span id="category-filter-label" class="label mr-1">Category</span>
      <button
        v-for="tag in POPULAR_MOD_TAGS"
        :key="tag"
        type="button"
        class="chip"
        :disabled="disabled"
        :aria-pressed="selectedTag.toLowerCase() === tag.toLowerCase()"
        @click="emit('update:selectedTag', selectedTag.toLowerCase() === tag.toLowerCase() ? '' : tag)"
      >
        {{ tag }}
      </button>
    </div>

    <div class="flex flex-wrap items-end gap-4">
      <div class="min-w-44 max-w-xs flex-1">
        <label class="label block" for="mod-tag">Custom tag</label>
        <input
          id="mod-tag"
          class="field mt-1.5 h-9"
          type="text"
          placeholder="e.g. tech-tree"
          maxlength="128"
          :value="customTag"
          :disabled="disabled"
          @input="emit('update:customTag', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <label class="flex h-9 items-center gap-2.5 text-sm">
        <input
          id="compatible-only"
          type="checkbox"
          class="h-4 w-4 accent-accent"
          :checked="compatibleOnly"
          :disabled="disabled"
          @change="emit('update:compatibleOnly', ($event.target as HTMLInputElement).checked)"
        />
        <span>
          Compatible only
          <span v-if="kspVersion" class="readout text-muted">{{ kspVersion }}</span>
        </span>
      </label>
      <button class="btn btn-secondary btn-sm ml-auto" type="button" :disabled="disabled" @click="emit('resetFilters')">
        Reset filters
      </button>
    </div>
  </div>
</template>
