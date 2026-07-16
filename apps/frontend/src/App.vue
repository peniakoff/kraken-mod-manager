<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { DirectoryListingResponse, KspInstallation } from "@kraken/contracts";
import { getConfig, getDirectories, getHealth, getInstallations, saveInstallation } from "./api.js";

const status = ref<"checking" | "ready" | "unavailable" | "error">("checking");
const version = ref<string>();
const installation = ref<KspInstallation>();
const candidates = ref<KspInstallation[]>([]);
const errorMessage = ref<string>();
const directoryListing = ref<DirectoryListingResponse>();
const isSaving = ref(false);

async function loadSetup(): Promise<void> {
  status.value = "checking";
  errorMessage.value = undefined;

  try {
    const health = await getHealth();
    version.value = health.version;
    const config = await getConfig();
    if (config.configured) {
      installation.value = config.installation;
      candidates.value = [];
    } else {
      installation.value = undefined;
      candidates.value = (await getInstallations()).installations;
    }
    status.value = "ready";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "The local service is unavailable.";
    status.value = "unavailable";
  }
}

async function selectInstallation(path: string): Promise<void> {
  isSaving.value = true;
  errorMessage.value = undefined;
  try {
    const config = await saveInstallation(path);
    if (config.configured) {
      installation.value = config.installation;
      candidates.value = [];
      directoryListing.value = undefined;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "The installation could not be saved.";
    status.value = "error";
  } finally {
    isSaving.value = false;
  }
}

async function openBrowser(path?: string): Promise<void> {
  errorMessage.value = undefined;
  try {
    directoryListing.value = await getDirectories(path);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "The directory browser could not be opened.";
    status.value = "error";
  }
}

async function openChild(name: string): Promise<void> {
  if (directoryListing.value === undefined) {
    return;
  }
  await openBrowser(`${directoryListing.value.currentPath}/${name}`);
}

onMounted(loadSetup);
</script>

<template>
  <main class="min-h-screen bg-slate-950 p-8 text-slate-100">
    <section class="mx-auto max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-8 shadow-xl">
      <p class="text-sm font-semibold uppercase tracking-widest text-cyan-400">Kraken Mod Manager</p>
      <h1 class="mt-3 text-3xl font-bold">Choose your Kerbal Space Program installation.</h1>
      <p class="mt-4 text-slate-300">
        Kraken needs one validated KSP installation before it can manage mods.
      </p>
      <div class="mt-6 flex items-center gap-3" aria-live="polite">
        <span
          class="h-3 w-3 rounded-full"
          :class="{
            'bg-amber-400': status === 'checking',
            'bg-emerald-400': status === 'ready',
            'bg-rose-400': status === 'unavailable' || status === 'error',
          }"
        />
        <span v-if="status === 'checking'">Checking local service…</span>
        <span v-else-if="status === 'ready'">Service connected ({{ version }})</span>
        <span v-else>{{ errorMessage ?? "Local service is unavailable." }}</span>
      </div>

      <section v-if="installation !== undefined" class="mt-8 rounded-lg border border-emerald-800 bg-emerald-950/30 p-5">
        <h2 class="font-semibold text-emerald-300">Active installation</h2>
        <p class="mt-2 break-all font-mono text-sm">{{ installation.path }}</p>
        <p class="mt-2 text-sm text-slate-300">KSP version: {{ installation.version ?? "Unknown" }}</p>
      </section>

      <section v-else-if="status === 'ready'" class="mt-8">
        <h2 class="font-semibold">Detected installations</h2>
        <p v-if="candidates.length === 0" class="mt-2 text-slate-300">No supported installation was found automatically.</p>
        <ul v-else class="mt-3 space-y-3">
          <li v-for="candidate in candidates" :key="candidate.path" class="rounded-lg border border-slate-700 p-4">
            <p class="break-all font-mono text-sm">{{ candidate.path }}</p>
            <p class="mt-1 text-sm text-slate-300">{{ candidate.source }} · {{ candidate.version ?? "Unknown version" }}</p>
            <button class="mt-3 rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400" type="button" :disabled="isSaving" @click="selectInstallation(candidate.path)">
              Use this installation
            </button>
          </li>
        </ul>
        <button class="mt-6 rounded-md border border-cyan-400 px-4 py-2 font-semibold text-cyan-300 hover:bg-cyan-400/10" type="button" @click="openBrowser()">
          Browse folders manually
        </button>
      </section>

      <section v-if="directoryListing !== undefined && installation === undefined" class="mt-8 rounded-lg border border-slate-700 p-5">
        <h2 class="font-semibold">Select a KSP folder</h2>
        <p class="mt-2 break-all font-mono text-sm text-slate-300">{{ directoryListing.currentPath }}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button v-if="directoryListing.parentPath !== null" class="rounded border border-slate-600 px-3 py-1 text-sm" type="button" @click="openBrowser(directoryListing.parentPath)">Up</button>
          <button class="rounded bg-cyan-500 px-3 py-1 text-sm font-semibold text-slate-950" type="button" :disabled="isSaving" @click="selectInstallation(directoryListing.currentPath)">Use this folder</button>
        </div>
        <ul class="mt-4 max-h-64 overflow-y-auto rounded border border-slate-800">
          <li v-for="directory in directoryListing.directories" :key="directory">
            <button class="block w-full px-3 py-2 text-left font-mono text-sm hover:bg-slate-800" type="button" @click="openChild(directory)">{{ directory }}/</button>
          </li>
        </ul>
      </section>

      <button class="mt-6 rounded-md bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400" type="button" @click="loadSetup">
        Check again
      </button>
    </section>
  </main>
</template>
