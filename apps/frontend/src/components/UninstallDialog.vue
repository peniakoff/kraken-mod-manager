<script setup lang="ts">
import type { UninstallPlanResponse } from "@kraken/contracts";
import { ref, watch } from "vue";

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

function orphanInputId(identifier: string): string {
  return `uninstall-orphan-${encodeURIComponent(identifier)}`;
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="uninstall-dialog-title"
  >
    <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
      <h2 id="uninstall-dialog-title" class="text-xl font-semibold">Uninstall {{ plan.target.name }}?</h2>

      <div class="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <ul v-if="plan.warnings.length > 0" class="space-y-1 text-sm text-amber-300">
          <li v-for="warning in plan.warnings" :key="warning">{{ warning }}</li>
        </ul>

        <section v-if="plan.dependents.length > 0">
          <h3 class="text-sm font-medium text-slate-200">This will also remove:</h3>
          <ul class="mt-2 space-y-1 text-sm text-slate-300">
            <li v-for="dependent in plan.dependents" :key="dependent.identifier">
              {{ dependent.name }}
              <span v-if="dependent.version" class="font-mono text-slate-400">{{ dependent.version }}</span>
            </li>
          </ul>
        </section>

        <fieldset v-if="plan.orphans.length > 0">
          <legend class="text-sm font-medium text-slate-200">No longer needed:</legend>
          <div class="mt-2 space-y-1">
            <div v-for="orphan in plan.orphans" :key="orphan.identifier" class="flex items-center gap-2">
              <input
                :id="orphanInputId(orphan.identifier)"
                v-model="selectedOrphans"
                type="checkbox"
                class="accent-cyan-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                :value="orphan.identifier"
              />
              <label :for="orphanInputId(orphan.identifier)" class="text-sm text-slate-300">
                {{ orphan.name }}
                <span v-if="orphan.version" class="font-mono text-slate-400">{{ orphan.version }}</span>
              </label>
            </div>
          </div>
        </fieldset>

        <section v-if="plan.brokenUnmanaged.length > 0">
          <h3 class="text-sm font-medium text-amber-300">These manually installed mods will stop working:</h3>
          <ul class="mt-2 space-y-1 text-sm text-slate-300">
            <li v-for="broken in plan.brokenUnmanaged" :key="broken.identifier">{{ broken.name }}</li>
          </ul>
        </section>
      </div>

      <p v-if="error !== undefined" role="alert" class="mt-4 rounded-md border border-rose-400/60 p-3 text-sm text-rose-300">
        {{ error }}
      </p>

      <div class="mt-6 flex flex-wrap gap-3">
        <button
          class="rounded-md bg-rose-400 px-4 py-2 font-semibold text-slate-950 hover:bg-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          :disabled="busy"
          @click="confirm"
        >
          {{ busy ? "Uninstalling…" : "Uninstall" }}
        </button>
        <button
          class="rounded-md border border-slate-600 px-4 py-2 font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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
