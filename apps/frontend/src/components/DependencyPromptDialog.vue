<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CkanModule, InstallPlanOptional, InstallPlanResponse } from "@kraken/contracts";
import { useModalFocus } from "../useModalFocus.js";

export type DependencyPrompt = {
  mod: CkanModule;
  plan: InstallPlanResponse;
  choices: Record<string, string>;
  /** Recommended and suggested mods offered with this install, each with a module. */
  offered?: InstallPlanOptional[];
  /** Identifiers of offered mods that start out picked. */
  selected?: string[];
  /** True once the user has confirmed the optional mods; the dialog then only asks for choices. */
  confirmed?: boolean;
  /** Identifiers from the plan's install list that the user has already been shown. */
  seen?: string[];
};

const props = defineProps<{ prompt: DependencyPrompt }>();

const emit = defineEmits<{
  confirm: [optional: string[]];
  cancel: [];
  continueWithChoices: [choices: Record<string, string>];
}>();

const missingDependencies = computed(() =>
  props.prompt.plan.toInstall.filter((entry) => entry.identifier !== props.prompt.mod.identifier),
);

const pendingChoices = computed(() =>
  props.prompt.plan.status === "choice-required" ? props.prompt.plan.choices : [],
);

const selectedChoices = ref<Record<string, string>>({});
const pickedOptional = ref<string[]>([...(props.prompt.selected ?? [])]);
watch(
  () => props.prompt,
  (prompt) => {
    selectedChoices.value = {};
    pickedOptional.value = [...(prompt.selected ?? [])];
  },
);

const optionalGroups = computed(() =>
  (
    [
      { kind: "recommends", legend: "Recommended" },
      { kind: "suggests", legend: "Suggested" },
    ] as const
  )
    .map((group) => ({
      ...group,
      entries: (props.prompt.offered ?? []).flatMap((entry) =>
        entry.kind === group.kind && entry.module !== undefined ? [{ ...entry, module: entry.module }] : [],
      ),
    }))
    .filter((group) => group.entries.length > 0),
);

const allChoicesSelected = computed(() =>
  pendingChoices.value.every((choice) => selectedChoices.value[choice.key] !== undefined),
);

function requiredByLabel(identifiers: string[]): string {
  const { target, toInstall } = props.prompt.plan;
  const names = new Map([target, ...toInstall].map((ref) => [ref.identifier, ref.name]));
  return identifiers.map((identifier) => names.get(identifier) ?? identifier).join(", ");
}

function optionalSource(requiredBy: string): string | undefined {
  return requiredBy === props.prompt.mod.identifier ? undefined : requiredByLabel([requiredBy]);
}

function choiceInputId(key: string, identifier: string): string {
  return `choice-${encodeURIComponent(key)}-${encodeURIComponent(identifier)}`;
}

function continueWithChoices(): void {
  if (!allChoicesSelected.value) {
    return;
  }
  emit("continueWithChoices", { ...props.prompt.choices, ...selectedChoices.value });
}

const containerRef = ref<HTMLElement>();

useModalFocus({ container: containerRef, onEscape: () => emit("cancel") });
</script>

<template>
  <div
    class="dialog-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="dependency-prompt-title"
  >
    <div v-if="pendingChoices.length > 0" ref="containerRef" class="dialog">
      <h2 id="dependency-prompt-title" class="text-xl font-semibold">Choose a provider</h2>
      <p class="mt-2 text-muted">
        {{ prompt.mod.name }} needs one of several mods. Pick the one to install.
      </p>
      <div class="mt-5 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <fieldset v-for="choice in pendingChoices" :key="choice.key" class="rounded-md border border-line p-4">
          <legend class="px-1 text-sm font-medium">{{ choice.label }}, required by {{ requiredByLabel(choice.requiredBy) }}</legend>
          <div class="mt-1 space-y-1">
            <div
              v-for="candidate in choice.candidates"
              :key="candidate.identifier"
              class="flex items-center gap-3 rounded-sm px-1 py-1.5 hover:bg-raised"
            >
              <input
                :id="choiceInputId(choice.key, candidate.identifier)"
                v-model="selectedChoices[choice.key]"
                type="radio"
                class="h-4 w-4 accent-accent"
                :name="`choice-${choice.key}`"
                :value="candidate.identifier"
              />
              <label :for="choiceInputId(choice.key, candidate.identifier)" class="text-sm">
                {{ candidate.name }}
                <span class="readout text-muted">{{ candidate.version }}</span>
                <span v-if="candidate.via === 'provides'" class="ml-1 text-[13px] text-muted">provides {{ choice.label }}</span>
              </label>
            </div>
          </div>
        </fieldset>
      </div>
      <div class="mt-6 flex flex-wrap gap-3">
        <button class="btn btn-primary" type="button" :disabled="!allChoicesSelected" @click="continueWithChoices">
          Continue
        </button>
        <button class="btn btn-secondary" type="button" @click="emit('cancel')">Cancel</button>
      </div>
    </div>
    <div v-else ref="containerRef" class="dialog">
      <template v-if="missingDependencies.length > 0">
        <template v-if="prompt.confirmed === true">
          <h2 id="dependency-prompt-title" class="text-xl font-semibold">Install these mods too?</h2>
          <p class="mt-2 text-muted">{{ prompt.mod.name }} and the mods you picked need:</p>
        </template>
        <template v-else>
          <h2 id="dependency-prompt-title" class="text-xl font-semibold">Install required dependencies?</h2>
          <p class="mt-2 text-muted">
            {{ prompt.mod.name }} requires
            {{ missingDependencies.map((entry) => entry.name).join(", ") }}. Install them automatically?
          </p>
        </template>
        <ul class="mt-4 divide-y divide-line rounded-md border border-line text-sm">
          <li v-for="entry in missingDependencies" :key="entry.identifier" class="flex justify-between gap-3 px-3 py-2">
            <span>{{ entry.name }}</span>
            <span class="readout text-muted">{{ entry.version }}</span>
          </li>
        </ul>
      </template>
      <template v-else>
        <h2 id="dependency-prompt-title" class="text-xl font-semibold">Install {{ prompt.mod.name }}?</h2>
        <p class="mt-2 text-muted">Other mods work well with it. Pick any to install at the same time.</p>
      </template>

      <div v-if="prompt.confirmed !== true && optionalGroups.length > 0" class="mt-5 max-h-[45vh] space-y-4 overflow-y-auto pr-1">
        <fieldset v-for="group in optionalGroups" :key="group.kind" class="rounded-md border border-line p-4">
          <legend class="px-1 text-sm font-medium">{{ group.legend }}</legend>
          <div class="mt-1 space-y-1">
            <div
              v-for="entry in group.entries"
              :key="entry.module.identifier"
              class="flex items-center gap-3 rounded-sm px-1 py-1.5 hover:bg-raised"
            >
              <input
                :id="`optional-${entry.module.identifier}`"
                v-model="pickedOptional"
                type="checkbox"
                class="h-4 w-4 accent-accent"
                :value="entry.module.identifier"
              />
              <label :for="`optional-${entry.module.identifier}`" class="text-sm">
                {{ entry.module.name }}
                <span class="readout text-muted">{{ entry.module.version }}</span>
                <span v-if="optionalSource(entry.requiredBy) !== undefined" class="ml-1 text-[13px] text-muted">
                  for {{ optionalSource(entry.requiredBy) }}
                </span>
              </label>
            </div>
          </div>
        </fieldset>
      </div>

      <div class="mt-6 flex flex-wrap gap-3">
        <button class="btn btn-primary" type="button" @click="emit('confirm', [...pickedOptional])">
          {{ missingDependencies.length > 0 && prompt.confirmed !== true ? "Install automatically" : "Install" }}
        </button>
        <button class="btn btn-secondary" type="button" @click="emit('cancel')">Cancel</button>
      </div>
    </div>
  </div>
</template>
