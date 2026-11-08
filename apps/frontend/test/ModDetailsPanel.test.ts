import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ModDetailsPanel from "../src/components/ModDetailsPanel.vue";

const sampleMod = {
  identifier: "ModuleManager",
  name: "Module Manager",
  authors: ["sarbian", "ialdabaoth"],
  version: "4.2.3",
  abstract: "Patching plugin for KSP",
  description: "Detailed description of how Module Manager modifies configs dynamically at runtime.",
  license: "CC-BY-SA",
  tags: ["plugin", "library"],
  download: "https://example.test/mm-4.2.3.zip",
  downloadSize: 68432,
  kspVersionMin: "1.8.0",
  kspVersionMax: "1.12.99",
  resources: {
    homepage: "https://forum.kerbalspaceprogram.com/topic/50533-module-manager/",
    repository: "https://github.com/sarbian/ModuleManager",
    bugtracker: "https://github.com/sarbian/ModuleManager/issues",
    spacedock: "https://spacedock.info/mod/123",
  },
  relationships: {
    depends: [{ kind: "single" as const, name: "KSP-AVC", minVersion: "1.4.0" }],
    conflicts: [{ kind: "single" as const, name: "OldModuleManager" }],
    recommends: [{ kind: "single" as const, name: "ToolbarController" }],
    suggests: [{ kind: "single" as const, name: "ClickThroughBlocker" }],
  },
};

const sampleModV422 = {
  ...sampleMod,
  version: "4.2.2",
  download: "https://example.test/mm-4.2.2.zip",
};

describe("ModDetailsPanel component", () => {
  it("shows the Install button and a Metapackage badge, without a size, for a metapackage", () => {
    const { download: _download, ...withoutDownload } = sampleMod;
    const metapackage = { ...withoutDownload, kind: "metapackage" as const };
    const wrapper = mount(ModDetailsPanel, {
      props: { mod: metapackage, versions: [metapackage], kspVersion: "1.12.5", installedMods: [], availableUpdates: [] },
    });

    expect(wrapper.get('[data-testid="metapackage-badge"]').text()).toBe("Metapackage");
    expect(wrapper.find('[data-testid="details-install-btn"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Download size");
  });

  it("shows an Imported badge for an imported modpack only", () => {
    const { download: _download, ...withoutDownload } = sampleMod;
    const imported = { ...withoutDownload, kind: "metapackage" as const, source: "imported" as const };
    const shared = { kspVersion: "1.12.5", installedMods: [], availableUpdates: [] };

    const wrapper = mount(ModDetailsPanel, { props: { mod: imported, versions: [imported], ...shared } });
    expect(wrapper.get('[data-testid="imported-badge"]').text()).toBe("Imported");

    const plain = mount(ModDetailsPanel, { props: { mod: sampleMod, versions: [sampleMod], ...shared } });
    expect(plain.find('[data-testid="imported-badge"]').exists()).toBe(false);
  });

  it("renders mod information, description, license, and safe project links", () => {
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: sampleMod,
        versions: [sampleMod, sampleModV422],
        kspVersion: "1.12.5",
        installedMods: [],
        availableUpdates: [],
      },
    });

    expect(wrapper.find("#mod-details-title").text()).toBe("Module Manager");
    expect(wrapper.text()).toContain("ModuleManager");
    expect(wrapper.text()).toContain("sarbian, ialdabaoth");
    expect(wrapper.text()).toContain("CC-BY-SA");
    expect(wrapper.text()).toContain("Detailed description of how Module Manager modifies configs");
    expect(wrapper.text()).toContain("Compatible with KSP 1.12.5");

    // Project links
    const homepageLink = wrapper.find('[data-testid="resource-link-homepage"]');
    expect(homepageLink.exists()).toBe(true);
    expect(homepageLink.attributes("href")).toBe("https://forum.kerbalspaceprogram.com/topic/50533-module-manager/");
    expect(homepageLink.attributes("target")).toBe("_blank");
    expect(homepageLink.attributes("rel")).toBe("noopener noreferrer");

    const repoLink = wrapper.find('[data-testid="resource-link-repository"]');
    expect(repoLink.exists()).toBe(true);

    const bugtrackerLink = wrapper.find('[data-testid="resource-link-bugtracker"]');
    expect(bugtrackerLink.exists()).toBe(true);
  });

  it("strips unsafe javascript: and data: URLs from project links", () => {
    const unsafeMod = {
      ...sampleMod,
      resources: {
        homepage: "javascript:alert('XSS')",
        repository: "data:text/html,<script>alert(1)</script>",
        spacedock: "https://spacedock.info/mod/123",
      },
    };
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: unsafeMod,
        versions: [unsafeMod],
        installedMods: [],
        availableUpdates: [],
      },
    });

    expect(wrapper.find('[data-testid="resource-link-homepage"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="resource-link-repository"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="resource-link-spacedock"]').exists()).toBe(true);
  });

  it("displays fallback message when no relationships are declared or arrays are empty", () => {
    const emptyRelMod = {
      ...sampleMod,
      relationships: {
        depends: [],
        conflicts: [],
        recommends: [],
        suggests: [],
      },
    };
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: emptyRelMod,
        versions: [emptyRelMod],
        installedMods: [],
        availableUpdates: [],
      },
    });

    expect(wrapper.text()).toContain("No dependencies declared.");
  });

  it("falls back to abstract when description is not provided", () => {
    const modWithoutDesc = { ...sampleMod, description: undefined };
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: modWithoutDesc,
        versions: [modWithoutDesc],
        installedMods: [],
        availableUpdates: [],
      },
    });

    expect(wrapper.text()).toContain("Patching plugin for KSP");
  });

  it("displays dependencies, conflicts, and recommendations", () => {
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: sampleMod,
        versions: [sampleMod],
        installedMods: [],
        availableUpdates: [],
      },
    });

    expect(wrapper.text()).toContain("KSP-AVC >= 1.4.0");
    expect(wrapper.text()).toContain("OldModuleManager");
    expect(wrapper.text()).toContain("ToolbarController");
    expect(wrapper.text()).toContain("ClickThroughBlocker");
  });

  it("renders any_of groups as one of", () => {
    const anyOfMod = {
      ...sampleMod,
      relationships: {
        ...sampleMod.relationships,
        depends: [
          {
            kind: "anyOf" as const,
            alternatives: [
              { kind: "single" as const, name: "TextureReplacer" },
              { kind: "single" as const, name: "DiRT" },
            ],
          },
        ],
      },
    };
    const wrapper = mount(ModDetailsPanel, {
      props: { mod: anyOfMod, versions: [anyOfMod], installedMods: [], availableUpdates: [] },
    });

    expect(wrapper.text()).toContain("one of TextureReplacer, DiRT");
  });

  it("lists provided names", () => {
    const providerMod = { ...sampleMod, provides: ["EVE-Config"] };
    const wrapper = mount(ModDetailsPanel, {
      props: { mod: providerMod, versions: [providerMod], installedMods: [], availableUpdates: [] },
    });

    expect(wrapper.text()).toContain("Provides:");
    expect(wrapper.text()).toContain("EVE-Config");
  });

  it("handles version switching", async () => {
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: sampleMod,
        versions: [sampleMod, sampleModV422],
        installedMods: [],
        availableUpdates: [],
      },
    });

    const select = wrapper.find('[data-testid="version-select"]');
    expect(select.exists()).toBe(true);

    await select.setValue("4.2.2");
    expect(wrapper.emitted("selectVersion")).toEqual([[sampleModV422]]);
  });

  it("displays installed and update badges and handles install/uninstall actions", async () => {
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: sampleMod,
        versions: [sampleMod],
        installedMods: [{ identifier: "ModuleManager", name: "Module Manager", version: "4.2.2", status: "managed" }],
        availableUpdates: [{ identifier: "ModuleManager", name: "Module Manager", installedVersion: "4.2.2", availableVersion: "4.2.3" }],
      },
    });

    expect(wrapper.find('[data-testid="details-installed-badge"]').text()).toBe("Installed 4.2.2");
    expect(wrapper.find('[data-testid="details-update-badge"]').text()).toBe("Update 4.2.3 available");

    const uninstallBtn = wrapper.find('[data-testid="details-uninstall-btn"]');
    expect(uninstallBtn.exists()).toBe(true);
    await uninstallBtn.trigger("click");
    expect(wrapper.emitted("uninstall")).toEqual([[{ identifier: "ModuleManager", name: "Module Manager", version: "4.2.2", status: "managed" }]]);

    const installBtn = wrapper.find('[data-testid="details-install-btn"]');
    expect(installBtn.text()).toBe("Reinstall");
    await installBtn.trigger("click");
    expect(wrapper.emitted("install")).toEqual([[sampleMod]]);
  });

  it("shows versions as published, without adding a second v prefix", () => {
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: { ...sampleMod, version: "v112.0.1" },
        versions: [{ ...sampleMod, version: "v112.0.1" }],
        installedMods: [{ identifier: "ModuleManager", name: "Module Manager", version: "v112.0.1", status: "managed" }],
        availableUpdates: [],
      },
    });

    expect(wrapper.find('[data-testid="details-installed-badge"]').text()).toBe("Installed v112.0.1");
    expect(wrapper.text()).not.toContain("vv112");
  });

  it("keeps the install button focusable but inert while the mod is installing", async () => {
    const wrapper = mount(ModDetailsPanel, {
      props: { mod: sampleMod, versions: [sampleMod], installedMods: [], availableUpdates: [], busy: new Map([["modulemanager", "installing" as const]]) },
    });
    const install = wrapper.find('[data-testid="details-install-btn"]');

    expect(install.attributes("disabled")).toBeUndefined();
    expect(install.attributes("aria-disabled")).toBe("true");
    await install.trigger("click");
    expect(wrapper.emitted("install")).toBeUndefined();
  });

  it("blocks Uninstall and Update for a queued mod and keeps the accessible names", async () => {
    const installedMods = [{ identifier: "ModuleManager", name: "Module Manager", version: "4.2.2", status: "managed" as const }];
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: sampleMod,
        versions: [sampleMod, sampleModV422],
        installedMods,
        availableUpdates: [
          { identifier: "ModuleManager", name: "Module Manager", installedVersion: "4.2.2", availableVersion: "4.2.3" },
        ],
        busy: new Map([["modulemanager", "queued" as const]]),
      },
    });
    const uninstall = wrapper.find('[data-testid="details-uninstall-btn"]');
    const update = wrapper.find('[data-testid="details-update-btn"]');

    expect(uninstall.text()).toBe("Queued");
    expect(uninstall.attributes("aria-disabled")).toBe("true");
    expect(uninstall.attributes("aria-label")).toBe("Uninstall Module Manager");
    expect(update.attributes("aria-disabled")).toBe("true");
    await uninstall.trigger("click");
    await update.trigger("click");
    expect(wrapper.emitted("uninstall")).toBeUndefined();
    expect(wrapper.emitted("install")).toBeUndefined();
  });

  it("shows Uninstalling… while an uninstall job runs", () => {
    const installedMods = [{ identifier: "ModuleManager", name: "Module Manager", version: "4.2.3", status: "managed" as const }];
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: sampleMod,
        versions: [sampleMod],
        installedMods,
        availableUpdates: [],
        busy: new Map([["modulemanager", "uninstalling" as const]]),
      },
    });

    expect(wrapper.find('[data-testid="details-uninstall-btn"]').text()).toBe("Uninstalling…");
  });

  it("emits close on close button click and escape key", async () => {
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: sampleMod,
        versions: [sampleMod],
        installedMods: [],
        availableUpdates: [],
      },
    });

    const closeBtn = wrapper.find('[data-testid="close-details-btn"]');
    await closeBtn.trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(2);
  });

  it("updates to the available version from the update badge", async () => {
    const wrapper = mount(ModDetailsPanel, {
      props: {
        mod: sampleModV422,
        versions: [sampleMod, sampleModV422],
        kspVersion: "1.12.5",
        installedMods: [{ identifier: "ModuleManager", name: "Module Manager", version: "4.2.2", status: "managed" }],
        availableUpdates: [
          { identifier: "ModuleManager", name: "Module Manager", installedVersion: "4.2.2", availableVersion: "4.2.3" },
        ],
      },
    });

    const button = wrapper.find('[data-testid="details-update-btn"]');
    expect(button.text()).toBe("Update to 4.2.3");
    await button.trigger("click");
    expect(wrapper.emitted("install")).toEqual([[sampleMod]]);
  });
});
