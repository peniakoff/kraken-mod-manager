<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getHealth } from "./api.js";

const status = ref<"checking" | "connected" | "unavailable">("checking");
const version = ref<string>();

async function checkConnection(): Promise<void> {
  status.value = "checking";

  try {
    const health = await getHealth();
    version.value = health.version;
    status.value = "connected";
  } catch {
    status.value = "unavailable";
  }
}

onMounted(checkConnection);
</script>

<template>
  <main class="min-h-screen bg-slate-950 p-8 text-slate-100">
    <section class="mx-auto max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-8 shadow-xl">
      <p class="text-sm font-semibold uppercase tracking-widest text-cyan-400">Kraken Mod Manager</p>
      <h1 class="mt-3 text-3xl font-bold">KSP mod management, ready for launch.</h1>
      <p class="mt-4 text-slate-300">
        The frontend is connected to the local Kraken service.
      </p>
      <div class="mt-6 flex items-center gap-3" aria-live="polite">
        <span
          class="h-3 w-3 rounded-full"
          :class="{
            'bg-amber-400': status === 'checking',
            'bg-emerald-400': status === 'connected',
            'bg-rose-400': status === 'unavailable',
          }"
        />
        <span v-if="status === 'checking'">Checking local service…</span>
        <span v-else-if="status === 'connected'">Service connected ({{ version }})</span>
        <span v-else>Local service is unavailable.</span>
      </div>
      <button
        class="mt-6 rounded-md bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400"
        type="button"
        @click="checkConnection"
      >
        Check again
      </button>
    </section>
  </main>
</template>
