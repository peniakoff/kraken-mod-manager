<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <header class="mb-8 flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <h1 class="text-[28px] font-semibold leading-tight md:text-[32px]">{{ title }}</h1>
      <div class="mt-2 text-[15px] text-muted">
        <slot />
      </div>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
