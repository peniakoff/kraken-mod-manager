<script setup lang="ts">
export type AppView = "dashboard" | "browse";

defineProps<{
  activeView: AppView;
  serviceVersion?: string;
  status: "checking" | "ready" | "unavailable" | "error";
  errorMessage?: string;
}>();

defineEmits<{
  navigate: [view: AppView];
}>();
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <header class="border-b border-slate-800 bg-slate-900/80">
      <div class="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-4">
        <div class="flex items-center gap-3">
          <img src="/icon-192.png" alt="" width="40" height="40" class="h-10 w-10 rounded-lg" />
          <div>
            <p class="text-sm font-semibold uppercase tracking-widest text-cyan-400">Kraken Mod Manager</p>
            <p class="text-xs text-slate-400" aria-live="polite">
              <span v-if="status === 'checking'">Checking local service…</span>
              <span v-else-if="status === 'ready'">Service connected{{ serviceVersion ? ` (${serviceVersion})` : "" }}</span>
              <span v-else>{{ errorMessage ?? "Local service is unavailable." }}</span>
            </p>
          </div>
        </div>
        <nav class="ml-auto flex gap-2" aria-label="Primary">
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm font-semibold"
            :class="
              activeView === 'dashboard'
                ? 'bg-cyan-500 text-slate-950'
                : 'border border-slate-600 text-slate-200 hover:bg-slate-800'
            "
            @click="$emit('navigate', 'dashboard')"
          >
            Dashboard
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm font-semibold"
            :class="
              activeView === 'browse'
                ? 'bg-cyan-500 text-slate-950'
                : 'border border-slate-600 text-slate-200 hover:bg-slate-800'
            "
            @click="$emit('navigate', 'browse')"
          >
            Browse mods
          </button>
        </nav>
      </div>
    </header>
    <div class="mx-auto max-w-5xl px-6 py-8">
      <p
        v-if="errorMessage !== undefined && (status === 'error' || status === 'unavailable')"
        class="mb-6 rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
        role="alert"
      >
        {{ errorMessage }}
      </p>
      <slot />
    </div>
  </div>
</template>
