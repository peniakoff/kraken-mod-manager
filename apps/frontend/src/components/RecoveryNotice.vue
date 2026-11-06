<script setup lang="ts">
import { computed } from "vue";
import type { InstallRecoveryReport } from "@kraken/contracts";
import AppIcon from "./AppIcon.vue";
import PathText from "./PathText.vue";

const props = defineProps<{ report: InstallRecoveryReport }>();

defineEmits<{ dismiss: [] }>();

const modules = computed(() => props.report.rolledBack.flatMap((job) => job.modules));
const visible = computed(
  () => modules.value.length > 0 || props.report.failed.length > 0 || backups.value.length > 0,
);
const backups = computed(() => props.report.untrackedBackups ?? []);
const backupCount = computed(() => backups.value.reduce((total, group) => total + group.count, 0));
const backupLabel = computed(() => (backupCount.value === 1 ? "1 backup folder" : `${backupCount.value} backup folders`));

function isOtherInstallation(installationPath: string): boolean {
  return installationPath !== props.report.activeInstallationPath;
}
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
            <div v-for="job in report.rolledBack" :key="job.jobId" class="mt-2">
              <p v-if="isOtherInstallation(job.installationPath)" class="text-muted">
                in <PathText :path="job.installationPath" />
              </p>
              <ul class="space-y-1">
                <li v-for="module in job.modules" :key="module.identifier" class="text-ink">
                  {{ module.name }}:
                  <span class="readout">{{
                    module.restoredVersion === undefined ? "removed" : `restored ${module.restoredVersion}`
                  }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div v-if="report.failed.length > 0" class="flex items-start gap-3 text-danger" role="alert">
          <AppIcon name="alert" :size="18" class="mt-0.5 shrink-0" />
          <div class="min-w-0">
            <p class="font-medium">An interrupted install could not be undone</p>
            <p class="mt-1">Its backups were kept. Kraken will try again at the next start.</p>
            <ul class="mt-2 space-y-1 break-words">
              <li v-for="(failure, index) in report.failed" :key="failure.jobId ?? index">
                <template v-if="isOtherInstallation(failure.installationPath)"
                  >in <PathText :path="failure.installationPath" />: </template
                >{{ failure.message }}
              </li>
            </ul>
          </div>
        </div>

        <div v-if="backups.length > 0" class="flex items-start gap-3" role="status">
          <AppIcon name="folder" :size="18" class="mt-0.5 shrink-0 text-warn" />
          <div class="min-w-0">
            <p class="font-medium text-ink">Backups Kraken cannot restore</p>
            <p class="mt-1 text-muted">
              Found {{ backupLabel }} that Kraken has no record of how to restore, for example from an interrupted
              install in Kraken 0.5.0 or earlier or from a rollback that failed. They may hold the only copy of a
              previous mod version, so check them before deleting anything:
            </p>
            <p v-for="group in backups" :key="group.directory" class="mt-1 text-ink">
              <template v-if="isOtherInstallation(group.installationPath)"
                >in <PathText :path="group.installationPath" />: </template
              ><PathText :path="group.directory" />
            </p>
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-icon" aria-label="Dismiss notice" @click="$emit('dismiss')">
        <AppIcon name="close" :size="16" />
      </button>
    </div>
  </section>
</template>
