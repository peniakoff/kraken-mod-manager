<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ path: string }>();

// Long install paths should wrap at separators, never in the middle of a folder name.
const segments = computed(() => props.path.split(/(?<=[/\\])/));
</script>

<template>
  <span class="readout"><template v-for="(segment, index) in segments" :key="index">{{ segment }}<wbr /></template></span>
</template>
