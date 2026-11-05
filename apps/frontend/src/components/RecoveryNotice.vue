<script setup lang="ts">
import { computed } from "vue";
import type { InstallRecoveryReport } from "@kraken/contracts";
import AppIcon from "./AppIcon.vue";
import PathText from "./PathText.vue";

const props = defineProps<{ report: InstallRecoveryReport }>();

defineEmits<{ dismiss: [] }>();

const modules = computed(() => props.report.rolledBack.flatMap((job) => job.modules));
const visible = computed(
  () => modules.value.length > 0 || props.report.failed.length > 0 || props.report.untrackedBackups !== undefined,
);
const backupLabel = computed(() => {
  const count = props.report.untrackedBackups?.count ?? 0;
  return count === 1 ? "1 backup folder" : `${count} backup folders`;
});
</script>

<template>
  <section v-if="visible" data-testid="recovery-notice" class="panel mb-6 px-4 py-4" aria-label="Install recovery">
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1 space-y-4 text-sm">
        <div v-if="modules.length > 0" class="flex items-start gap-3" role="status">
          <AppIcon name="check" :size="18" class="mt-0.5 shrink-0 text-ok" />
          <div class="min-w-0">
            <p class="font-medium text-ink">An interrupted install was undone</p>
            <p class="mt-1 text-muted">
              Kraken stopped before an install finished, so it put these mods back the way they were:
            </p>
            <ul class="mt-2 space-y-1">
              <li v-for="module in modules" :key="module.identifier" class="text-ink">
                {{ module.name }}:
                <span class="readout">{{
                  module.restoredVersion === undefined ? "removed" : `restored ${module.restoredVersion}`
                }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="report.failed.length > 0" class="flex items-start gap-3 text-danger" role="alert">
          <AppIcon name="alert" :size="18" class="mt-0.5 shrink-0" />
          <div class="min-w-0">
            <p class="font-medium">An interrupted install could not be undone</p>
            <p class="mt-1">Its backups were kept. Kraken will try again at the next start.</p>
            <ul class="mt-2 space-y-1 break-words">
              <li v-for="failure in report.failed" :key="failure.jobId">{{ failure.message }}</li>
            </ul>
          </div>
        </div>

        <div v-if="report.untrackedBackups !== undefined" class="flex items-start gap-3" role="status">
          <AppIcon name="folder" :size="18" class="mt-0.5 shrink-0 text-warn" />
          <div class="min-w-0">
            <p class="font-medium text-ink">Backups from an earlier version</p>
            <p class="mt-1 text-muted">
              Found {{ backupLabel }} left by an interrupted install in an earlier version of Kraken. They hold
              files of previous mod versions; restore or delete them by hand:
            </p>
            <p class="mt-1 text-ink"><PathText :path="report.untrackedBackups.directory" /></p>
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-icon" aria-label="Dismiss notice" @click="$emit('dismiss')">
        <AppIcon name="close" :size="16" />
      </button>
    </div>
  </section>
</template>
