import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import InstalledModsView from "../src/components/InstalledModsView.vue";

const props = {
  installedMods: [
    { identifier: "ModuleManager", name: "Module Manager", version: "4.2.3", status: "managed" },
    { identifier: "MechJeb2", name: "MechJeb 2", version: "2.15.4.0", status: "managed" },
    { identifier: "Firespitter", name: "Firespitter", status: "detected" },
  ],
  availableUpdates: [
    { identifier: "MechJeb2", name: "MechJeb 2", installedVersion: "2.15.4.0", availableVersion: "2.15.5.0" },
  ],
} as const;

function rows(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[data-testid="installed-row"]');
}

describe("InstalledModsView", () => {
  it("lists every installed mod with its version and status", () => {
    const wrapper = mount(InstalledModsView, { props });

    expect(rows(wrapper)).toHaveLength(3);
    expect(rows(wrapper)[0]!.text()).toContain("Module Manager");
    expect(rows(wrapper)[0]!.text()).toContain("4.2.3");
    expect(rows(wrapper)[0]!.text()).toContain("Managed");
    expect(rows(wrapper)[2]!.text()).toContain("Detected");
  });

  it("filters by name or identifier, ignoring case", async () => {
    const wrapper = mount(InstalledModsView, { props });

    await wrapper.find('input[type="search"]').setValue("mechjeb");
    expect(rows(wrapper)).toHaveLength(1);
    expect(rows(wrapper)[0]!.text()).toContain("MechJeb 2");

    await wrapper.find('input[type="search"]').setValue("modulemanager");
    expect(rows(wrapper)).toHaveLength(1);

    await wrapper.find('input[type="search"]').setValue("nothing-like-this");
    expect(rows(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain("No installed mods match");
  });

  it("offers uninstall only for managed mods", async () => {
    const wrapper = mount(InstalledModsView, { props });

    expect(rows(wrapper)[2]!.find('[data-testid="installed-uninstall-btn"]').exists()).toBe(false);
    await rows(wrapper)[0]!.find('[data-testid="installed-uninstall-btn"]').trigger("click");

    expect(wrapper.emitted("uninstall")).toEqual([[props.installedMods[0]]]);
  });

  it("offers an update where one is available", async () => {
    const wrapper = mount(InstalledModsView, { props });

    expect(rows(wrapper)[0]!.find('[data-testid="installed-update-btn"]').exists()).toBe(false);
    const update = rows(wrapper)[1]!.find('[data-testid="installed-update-btn"]');
    expect(update.attributes("aria-label")).toBe("Update MechJeb 2 to 2.15.5.0");
    await update.trigger("click");

    expect(wrapper.emitted("update")).toEqual([[props.availableUpdates[0]]]);
  });

  it("blocks Update and Uninstall for a mod with a queued job, without emitting", async () => {
    const busy = new Map([["mechjeb2", "queued" as const]]);
    const wrapper = mount(InstalledModsView, { props: { ...props, busy } });
    const row = rows(wrapper)[1]!;
    const uninstall = row.find('[data-testid="installed-uninstall-btn"]');
    const update = row.find('[data-testid="installed-update-btn"]');

    expect(uninstall.attributes("aria-disabled")).toBe("true");
    expect(uninstall.text()).toBe("Queued");
    expect(uninstall.attributes("aria-label")).toBe("Uninstall MechJeb 2");
    expect(update.attributes("aria-disabled")).toBe("true");
    await uninstall.trigger("click");
    await update.trigger("click");
    expect(wrapper.emitted("uninstall")).toBeUndefined();
    expect(wrapper.emitted("update")).toBeUndefined();
  });

  it("shows Uninstalling… and Updating… for running jobs", () => {
    const wrapper = mount(InstalledModsView, {
      props: { ...props, busy: new Map([["modulemanager", "uninstalling" as const], ["mechjeb2", "installing" as const]]) },
    });

    expect(rows(wrapper)[0]!.find('[data-testid="installed-uninstall-btn"]').text()).toBe("Uninstalling…");
    expect(rows(wrapper)[1]!.find('[data-testid="installed-update-btn"]').text()).toBe("Updating…");
  });

  it("shows an empty state when nothing is installed", () => {
    const wrapper = mount(InstalledModsView, { props: { ...props, installedMods: [] } });

    expect(wrapper.text()).toContain("No managed or detected mods yet.");
  });
  it("opens the file picker from the Import modpack button", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const wrapper = mount(InstalledModsView, { props });

    const button = wrapper.findAll("button").find((candidate) => candidate.text() === "Import modpack")!;
    await button.trigger("click");

    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toBe(wrapper.get('input[type="file"]').element);
    click.mockRestore();
  });

  it("keeps the file input out of the Tab order and emits the picked file", async () => {
    const wrapper = mount(InstalledModsView, { props });
    const input = wrapper.get('input[type="file"]');
    const file = new File(["{}"], "pack.ckan", { type: "application/json" });

    expect(input.attributes("tabindex")).toBe("-1");
    expect(input.attributes("accept")).toBe(".ckan,application/json");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    await input.trigger("change");

    expect(wrapper.emitted("importModpack")).toEqual([[file]]);
  });
});
