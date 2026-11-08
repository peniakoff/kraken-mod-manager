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
  busy: new Map(),
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

  it("offers Install and a Metapackage badge for a metapackage without a download", () => {
    const metapackage = {
      identifier: "Bundle",
      name: "Bundle",
      authors: ["someone"],
      version: "1.0.0",
      tags: [],
      kind: "metapackage" as const,
      downloadSize: 4096,
    };
    const wrapper = mount(BrowseModsView, { props: { ...baseProps, searchResults: [metapackage] } });

    const row = wrapper.get('[data-testid="mod-row"]');
    expect(row.get('[data-testid="metapackage-badge"]').text()).toBe("Metapackage");
    expect(row.findAll("button").some((button) => button.text() === "Install")).toBe(true);
    expect(row.text()).not.toContain("4 KB");
  });

  it("marks an imported modpack with an Imported badge", () => {
    const imported = {
      identifier: "Pack",
      name: "Pack",
      authors: ["someone"],
      version: "1.0.0",
      tags: [],
      kind: "metapackage" as const,
      source: "imported" as const,
    };
    const wrapper = mount(BrowseModsView, { props: { ...baseProps, searchResults: [imported] } });

    expect(wrapper.get('[data-testid="imported-badge"]').text()).toBe("Imported");
    expect(wrapper.get('[data-testid="metapackage-badge"]').text()).toBe("Metapackage");
  });

  it("hides Install for a DLC even when it has a download", () => {
    const dlc = {
      identifier: "MakingHistory",
      name: "Making History",
      authors: ["Squad"],
      version: "1.0.0",
      tags: [],
      kind: "dlc" as const,
      download: "https://example.test/dlc.zip",
    };
    const wrapper = mount(BrowseModsView, { props: { ...baseProps, searchResults: [dlc] } });

    expect(wrapper.findAll("button").some((button) => button.text() === "Install")).toBe(false);
    expect(wrapper.find('[data-testid="metapackage-badge"]').exists()).toBe(false);
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

const rssMod = {
  identifier: "RealSolarSystem",
  name: "Real Solar System",
  authors: ["NathanKell"],
  version: "1.0.0",
  tags: ["planet-pack"],
  download: "https://example.test/rss.zip",
};

const rssTarget = { identifier: "RealSolarSystem", name: "Real Solar System", version: "1.0.0" };

function choicePrompt(choices: Record<string, string> = {}) {
  return {
    mod: rssMod,
    choices,
    plan: {
      status: "choice-required" as const,
      target: rssTarget,
      toInstall: [rssTarget],
      alreadySatisfied: [],
      conflicts: [],
      unmet: [],
      optional: [],
      choices: [
        {
          key: "RSSTextures",
          label: "RSSTextures",
          requiredBy: ["RealSolarSystem"],
          candidates: [
            { identifier: "RSSTextures4096", name: "RSS Textures 4096", version: "1.0.0", via: "provides" as const },
            { identifier: "RSSTextures8192", name: "RSS Textures 8192", version: "1.0.0", via: "provides" as const },
          ],
        },
      ],
    },
  };
}

describe("BrowseModsView provider choices", () => {
  it("renders a fieldset per pending choice with radio candidates", () => {
    const wrapper = mount(BrowseModsView, { props: { ...baseProps, dependencyPrompt: choicePrompt() } });

    const fieldsets = wrapper.findAll("fieldset");
    expect(fieldsets).toHaveLength(1);
    expect(fieldsets[0]!.find("legend").text()).toBe("RSSTextures, required by Real Solar System");
    const radios = fieldsets[0]!.findAll('input[type="radio"]');
    expect(radios).toHaveLength(2);
    expect(new Set(radios.map((radio) => radio.attributes("name")))).toHaveProperty("size", 1);
    for (const radio of radios) {
      const label = wrapper.find(`label[for="${radio.attributes("id")}"]`);
      expect(label.text()).toContain("provides");
    }
  });

  it("keeps Continue disabled until every choice is selected", async () => {
    const wrapper = mount(BrowseModsView, { props: { ...baseProps, dependencyPrompt: choicePrompt() } });
    const continueButton = () => wrapper.findAll("button").find((button) => button.text() === "Continue")!;

    expect(continueButton().attributes("disabled")).toBeDefined();
    await wrapper.find('input[value="RSSTextures8192"]').setValue(true);
    expect(continueButton().attributes("disabled")).toBeUndefined();
  });

  it("emits continueWithChoices with the merged selections", async () => {
    const wrapper = mount(BrowseModsView, { props: { ...baseProps, dependencyPrompt: choicePrompt({ A: "x" }) } });

    await wrapper.find('input[value="RSSTextures8192"]').setValue(true);
    await wrapper.findAll("button").find((button) => button.text() === "Continue")!.trigger("click");

    expect(wrapper.emitted("continueWithChoices")).toEqual([[{ A: "x", RSSTextures: "RSSTextures8192" }]]);
  });

  it("shows the dependency confirmation when the plan is ok", () => {
    const okPrompt = {
      mod: rssMod,
      choices: { RSSTextures: "RSSTextures8192" },
      plan: {
        ...choicePrompt().plan,
        status: "ok" as const,
        choices: [],
        toInstall: [{ identifier: "RSSTextures8192", name: "RSS Textures 8192", version: "1.0.0" }, rssTarget],
      },
    };
    const wrapper = mount(BrowseModsView, { props: { ...baseProps, dependencyPrompt: okPrompt } });

    expect(wrapper.text()).toContain("Install required dependencies?");
    expect(wrapper.text()).toContain("Real Solar System requires");
    expect(wrapper.findAll("fieldset")).toHaveLength(0);
  });
});

describe("BrowseModsView install button while an install is pending", () => {
  it("stays focusable but inert, so focus can return to it after a dialog", async () => {
    const wrapper = mount(BrowseModsView, { props: { ...baseProps, busy: new Map([["modulemanager", "installing" as const]]) } });
    const install = wrapper.findAll("button").find((button) => button.text() === "Installing…")!;

    expect(install.attributes("disabled")).toBeUndefined();
    expect(install.attributes("aria-disabled")).toBe("true");
    await install.trigger("click");
    expect(wrapper.emitted("install")).toBeUndefined();
  });
});

describe("BrowseModsView install button for a queued mod", () => {
  it("shows Queued and stays inert", async () => {
    const wrapper = mount(BrowseModsView, { props: { ...baseProps, busy: new Map([["modulemanager", "queued" as const]]) } });
    const install = wrapper.findAll("button").find((button) => button.text() === "Queued")!;

    expect(install.attributes("aria-disabled")).toBe("true");
    await install.trigger("click");
    expect(wrapper.emitted("install")).toBeUndefined();
  });
});

describe("BrowseModsView dependency dialog keyboard", () => {
  function tab(shiftKey = false) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }));
  }

  it("moves focus into the dialog, traps Tab and restores focus on close", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const wrapper = mount(BrowseModsView, {
      props: { ...baseProps, dependencyPrompt: choicePrompt() },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    const dialog = wrapper.find('[role="dialog"]').element;
    const firstRadio = wrapper.find('input[value="RSSTextures4096"]').element;
    const cancel = wrapper.findAll("button").find((button) => button.text() === "Cancel")!.element;
    expect(document.activeElement).toBe(firstRadio);

    cancel.focus();
    tab();
    expect(document.activeElement).toBe(firstRadio);
    tab(true);
    expect(document.activeElement).toBe(cancel);
    expect(dialog.contains(document.activeElement)).toBe(true);

    await wrapper.setProps({ dependencyPrompt: undefined });
    expect(document.activeElement).toBe(opener);

    wrapper.unmount();
    opener.remove();
  });

  it("pulls focus back when the browser moves it out, as Tab does past a radio group", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const wrapper = mount(BrowseModsView, {
      props: { ...baseProps, dependencyPrompt: choicePrompt() },
      attachTo: document.body,
    });
    const dialog = wrapper.find('[role="dialog"]').element;

    outside.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);

    wrapper.unmount();
    outside.remove();
  });

  it("cancels on Escape without closing the details panel underneath", async () => {
    const underneath: string[] = [];
    const listener = (event: KeyboardEvent) => underneath.push(event.key);
    window.addEventListener("keydown", listener);
    const wrapper = mount(BrowseModsView, {
      props: { ...baseProps, selectedMod: rssMod, dependencyPrompt: choicePrompt() },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(wrapper.emitted("cancelDependencyInstall")).toEqual([[]]);
    expect(wrapper.emitted("selectMod")).toBeUndefined();
    expect(underneath).toEqual([]);

    wrapper.unmount();
    window.removeEventListener("keydown", listener);
  });
});
