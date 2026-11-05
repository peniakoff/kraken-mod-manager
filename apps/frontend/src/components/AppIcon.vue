<script setup lang="ts">
import { computed } from "vue";

export type IconName =
  | "overview"
  | "installed"
  | "browse"
  | "search"
  | "refresh"
  | "close"
  | "external"
  | "download"
  | "update"
  | "trash"
  | "check"
  | "alert"
  | "folder"
  | "arrow-up"
  | "chevron-left"
  | "chevron-right";

type IconShape = { paths: string[]; circles?: Array<[cx: number, cy: number, r: number]> };

// One stroke set on a 24px grid, so every glyph shares weight and corners.
const ICONS: Record<IconName, IconShape> = {
  overview: { paths: ["M4 16a8 8 0 1 1 16 0", "M12 16l4-5", "M4 20h16"] },
  installed: { paths: ["M12 3l8 4.5v9L12 21l-8-4.5v-9z", "M4 7.5l8 4.5 8-4.5", "M12 12v9"] },
  browse: { paths: ["M15.5 8.5l-2 5-5 2 2-5z"], circles: [[12, 12, 9]] },
  search: { paths: ["M20 20l-4.2-4.2"], circles: [[11, 11, 7]] },
  refresh: { paths: ["M20 12a8 8 0 1 1-2.34-5.66", "M20 4v5h-5"] },
  close: { paths: ["M6 6l12 12", "M18 6L6 18"] },
  external: {
    paths: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  },
  download: { paths: ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"] },
  update: { paths: ["M12 20V8", "M7 12l5-5 5 5", "M5 4h14"] },
  trash: { paths: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"] },
  check: { paths: ["M5 12.5l4.5 4.5L19 7.5"] },
  alert: { paths: ["M12 4l9 16H3z", "M12 10v4", "M12 17.5v.01"] },
  folder: { paths: ["M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"] },
  "arrow-up": { paths: ["M12 19V5", "M6 11l6-6 6 6"] },
  "chevron-left": { paths: ["M15 6l-6 6 6 6"] },
  "chevron-right": { paths: ["M9 6l6 6-6 6"] },
};

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 16 });

const shape = computed(() => ICONS[props.name]);
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    class="shrink-0"
  >
    <circle v-for="([cx, cy, r], index) in shape.circles ?? []" :key="`c${index}`" :cx="cx" :cy="cy" :r="r" />
    <path v-for="(d, index) in shape.paths" :key="`p${index}`" :d="d" />
  </svg>
</template>
