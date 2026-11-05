<script setup lang="ts">
import type { UninstallPlanResponse } from "@kraken/contracts";
import { ref, watch } from "vue";
import { useModalFocus } from "../useModalFocus.js";

const props = defineProps<{
  plan: UninstallPlanResponse;
  error?: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  confirm: [alsoRemove: string[]];
  cancel: [];
}>();

const selectedOrphans = ref<string[]>([]);

watch(
  () => props.plan,
  (plan) => {
    selectedOrphans.value = plan.orphans.map((orphan) => orphan.identifier);
  },
  { immediate: true },
);

function confirm(): void {
  const dependents = props.plan.dependents.map((dependent) => dependent.identifier);
  // Keep the plan's orphan order regardless of the order the boxes were ticked.
  const orphans = props.plan.orphans
    .map((orphan) => orphan.identifier)
    .filter((identifier) => selectedOrphans.value.includes(identifier));
  emit("confirm", [...dependents, ...orphans]);
}

const containerRef = ref<HTMLElement>();
const cancelButtonRef = ref<HTMLButtonElement>();

useModalFocus({
  container: containerRef,
  initialFocus: cancelButtonRef,
  onEscape: () => {
    if (!props.busy) {
      emit("cancel");
    }
  },
});

function orphanInputId(identifier: string): string {
  return `uninstall-orphan-${encodeURIComponent(identifier)}`;
}
</script>

<template>
  <div
    class="dialog-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="uninstall-dialog-title"
  >
    <div ref="containerRef" class="dialog">
      <h2 id="uninstall-dialog-title" class="text-xl font-semibold">Uninstall {{ plan.target.name }}?</h2>

      <p
        v-if="plan.warnings.length + plan.dependents.length + plan.orphans.length + plan.brokenUnmanaged.length === 0"
        class="mt-2 text-muted"
      >
        No other installed mod depends on it.
      </p>
      <div v-else class="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <ul v-if="plan.warnings.length > 0" class="space-y-1 rounded-md border border-warn/40 px-3 py-2 text-sm text-warn">
          <li v-for="warning in plan.warnings" :key="warning">{{ warning }}</li>
        </ul>

        <section v-if="plan.dependents.length > 0">
          <h3 class="text-sm font-medium">This will also remove:</h3>
          <ul class="mt-2 divide-y divide-line rounded-md border border-line text-sm">
            <li v-for="dependent in plan.dependents" :key="dependent.identifier" class="flex justify-between gap-3 px-3 py-2">
              {{ dependent.name }}
              <span v-if="dependent.version" class="readout text-muted">{{ dependent.version }}</span>
            </li>
          </ul>
        </section>

        <fieldset v-if="plan.orphans.length > 0">
          <legend class="text-sm font-medium">No longer needed:</legend>
          <div class="mt-2 space-y-1">
            <div v-for="orphan in plan.orphans" :key="orphan.identifier" class="flex items-center gap-3 rounded-sm px-1 py-1.5 hover:bg-raised">
              <input
                :id="orphanInputId(orphan.identifier)"
                v-model="selectedOrphans"
                type="checkbox"
                class="h-4 w-4 accent-accent"
                :value="orphan.identifier"
              />
              <label :for="orphanInputId(orphan.identifier)" class="text-sm">
                {{ orphan.name }}
                <span v-if="orphan.version" class="readout text-muted">{{ orphan.version }}</span>
              </label>
            </div>
          </div>
        </fieldset>

        <section v-if="plan.brokenUnmanaged.length > 0">
          <h3 class="text-sm font-medium text-warn">These manually installed mods will stop working:</h3>
          <ul class="mt-2 space-y-1 text-sm">
            <li v-for="broken in plan.brokenUnmanaged" :key="broken.identifier">{{ broken.name }}</li>
          </ul>
        </section>
      </div>

      <p v-if="error !== undefined" role="alert" class="mt-4 rounded-md border border-danger/50 p-3 text-sm text-danger">
        {{ error }}
      </p>

      <div class="mt-6 flex flex-wrap gap-3">
        <button
          class="btn btn-destructive"
          type="button"
          :disabled="busy"
          @click="confirm"
        >
          {{ busy ? "Uninstalling…" : "Uninstall" }}
        </button>
        <button
          class="btn btn-secondary"
          ref="cancelButtonRef"
          type="button"
          :disabled="busy"
          @click="emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>
