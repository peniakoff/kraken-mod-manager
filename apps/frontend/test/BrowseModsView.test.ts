import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BrowseModsView from "../src/components/BrowseModsView.vue";

const baseProps = {
  registry: { status: "ready", moduleCount: 2, updatedAt: "2026-07-17T12:00:00.000Z", parseErrors: 0 },
  isRefreshingRegistry: false,
  searchQuery: "",
  searchResults: [
    {
      identifier: "ModuleManager",
      name: "Module Manager",
      authors: ["sarbian"],
      version: "4.2.3",
      tags: ["plugin"],
      abstract: "Patching plugin",
      download: "https://example.test/mm.zip",
      downloadSize: 2048,
    },
    {
      identifier: "OldMod",
      name: "Old Mod",
      authors: ["someone"],
      version: "1.0.0",
      tags: ["parts"],
      kspVersionMax: "1.8.0",
    },
  ],
  searchTotal: 42,
  isSearching: false,
  installedMods: [{ identifier: "ModuleManager", name: "Module Manager", version: "4.2.3", status: "managed" }],
  availableUpdates: [
    { identifier: "ModuleManager", name: "Module Manager", installedVersion: "4.2.3", availableVersion: "4.2.4" },
  ],
  installingIdentifier: undefined,
  uninstallingIdentifier: undefined,
  jobProgress: undefined,
  dependencyPrompt: undefined,
  selectedTag: "",
  customTag: "",
  compatibleOnly: false,
  kspVersion: "1.12.5",
  pageSize: 25,
  currentPage: 0,
} as const;

describe("BrowseModsView mod browser", () => {
  it("renders rows with compatibility flags, tags, size and badges", () => {
    const wrapper = mount(BrowseModsView, { props: { ...baseProps } });

    const rows = wrapper.findAll('[data-testid="mod-row"]');
    expect(rows).toHaveLength(2);

    const flags = wrapper.findAll('[data-testid="compat-flag"]');
    expect(flags[0]?.text()).toContain("1.12.5");
    expect(flags[1]?.text()).toContain("May not be compatible");

    expect(wrapper.text()).toContain("plugin");
    expect(wrapper.text()).toContain("2 KB");
    expect(wrapper.find('[data-testid="installed-badge"]').text()).toContain("Installed");
    expect(wrapper.find('[data-testid="update-badge"]').text()).toContain("4.2.4");
  });

  it("shows an empty state when nothing matches", () => {
    const wrapper = mount(BrowseModsView, { props: { ...baseProps, searchResults: [], searchTotal: 0 } });
    expect(wrapper.text()).toContain("No mods match the current search and filters.");
  });

  it("bubbles filter and pagination events", async () => {
    const wrapper = mount(BrowseModsView, { props: { ...baseProps } });

    const partsButton = wrapper.findAll("button").find((button) => button.text() === "Parts");
    expect(partsButton).toBeDefined();
    await partsButton!.trigger("click");
    expect(wrapper.emitted("update:selectedTag")).toEqual([["Parts"]]);

    const nextButton = wrapper.findAll("button").find((button) => button.text() === "Next");
    expect(nextButton).toBeDefined();
    await nextButton!.trigger("click");
    expect(wrapper.emitted("update:page")).toEqual([[1]]);

    const resetButton = wrapper.findAll("button").find((button) => button.text() === "Reset filters");
    expect(resetButton).toBeDefined();
    await resetButton!.trigger("click");
    expect(wrapper.emitted("resetFilters")).toEqual([[]]);
  });

  it("emits selectMod when Details button is clicked and renders panel when selectedMod is set", async () => {
    const wrapper = mount(BrowseModsView, { props: { ...baseProps } });

    const detailsButtons = wrapper.findAll('[data-testid="mod-details-btn"]');
    expect(detailsButtons.length).toBeGreaterThan(0);
    await detailsButtons[0]!.trigger("click");
    expect(wrapper.emitted("selectMod")).toEqual([[baseProps.searchResults[0]]]);

    // Renders panel when selectedMod is provided
    const wrapperWithSelected = mount(BrowseModsView, {
      props: {
        ...baseProps,
        selectedMod: baseProps.searchResults[0],
        selectedModVersions: [baseProps.searchResults[0]],
      },
    });
    expect(wrapperWithSelected.find('[data-testid="mod-details-panel"]').exists()).toBe(true);
  });
});
