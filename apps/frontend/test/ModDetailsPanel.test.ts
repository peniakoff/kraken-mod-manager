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
    depends: [{ name: "KSP-AVC", minVersion: "1.4.0" }],
    conflicts: [{ name: "OldModuleManager" }],
    recommends: [{ name: "ToolbarController" }],
    suggests: [{ name: "ClickThroughBlocker" }],
  },
};

const sampleModV422 = {
  ...sampleMod,
  version: "4.2.2",
  download: "https://example.test/mm-4.2.2.zip",
};

describe("ModDetailsPanel component", () => {
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

    expect(wrapper.find('[data-testid="details-installed-badge"]').text()).toContain("Installed (v4.2.2)");
    expect(wrapper.find('[data-testid="details-update-badge"]').text()).toContain("Update to v4.2.3 available");

    const uninstallBtn = wrapper.find('[data-testid="details-uninstall-btn"]');
    expect(uninstallBtn.exists()).toBe(true);
    await uninstallBtn.trigger("click");
    expect(wrapper.emitted("uninstall")).toEqual([[{ identifier: "ModuleManager", name: "Module Manager", version: "4.2.2", status: "managed" }]]);

    const installBtn = wrapper.find('[data-testid="details-install-btn"]');
    expect(installBtn.text()).toBe("Reinstall");
    await installBtn.trigger("click");
    expect(wrapper.emitted("install")).toEqual([[sampleMod]]);
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
});
