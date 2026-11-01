import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { UninstallPlanResponse } from "@kraken/contracts";
import UninstallDialog from "../src/components/UninstallDialog.vue";

const plan: UninstallPlanResponse = {
  target: { identifier: "ModuleManager", name: "Module Manager", version: "4.2.3" },
  dependents: [{ identifier: "DependentMod", name: "Dependent Mod", version: "1.0.0" }],
  orphans: [
    { identifier: "O1", name: "Orphan One", version: "1.0.0" },
    { identifier: "O2", name: "Orphan Two" },
  ],
  brokenUnmanaged: [{ identifier: "Manual", name: "Manual Mod" }],
  warnings: ["The CKAN registry is not loaded, so Kraken cannot check which mods depend on this one."],
};

function clickButton(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text() === text);
  if (button === undefined) {
    throw new Error(`no button labelled ${text}`);
  }
  return button.trigger("click");
}

describe("UninstallDialog", () => {
  it("lists dependents, orphans, broken unmanaged mods and warnings", () => {
    const wrapper = mount(UninstallDialog, { props: { plan, busy: false } });

    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.attributes("aria-modal")).toBe("true");
    const titleId = dialog.attributes("aria-labelledby");
    expect(wrapper.find(`#${titleId}`).text()).toBe("Uninstall Module Manager?");
    expect(wrapper.text()).toContain("This will also remove:");
    expect(wrapper.text()).toContain("Dependent Mod");
    expect(wrapper.text()).toContain("No longer needed:");
    expect(wrapper.text()).toContain("Orphan One");
    expect(wrapper.text()).toContain("These manually installed mods will stop working:");
    expect(wrapper.text()).toContain("Manual Mod");
    expect(wrapper.text()).toContain(plan.warnings[0]);
  });

  it("hides empty sections", () => {
    const wrapper = mount(UninstallDialog, {
      props: { plan: { ...plan, dependents: [], orphans: [], brokenUnmanaged: [], warnings: [] }, busy: false },
    });

    expect(wrapper.text()).not.toContain("This will also remove:");
    expect(wrapper.text()).not.toContain("No longer needed:");
    expect(wrapper.text()).not.toContain("These manually installed mods will stop working:");
  });

  it("sends dependents and checked orphans", async () => {
    const wrapper = mount(UninstallDialog, { props: { plan, busy: false } });

    // Safe: the selector only matches <input> elements.
    const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.map((checkbox) => checkbox.element.checked)).toEqual([true, true]);
    await wrapper.find('input[value="O2"]').setValue(false);
    await clickButton(wrapper, "Uninstall");

    expect(wrapper.emitted("confirm")).toEqual([[["DependentMod", "O1"]]]);
  });

  it("labels every orphan checkbox", () => {
    const wrapper = mount(UninstallDialog, { props: { plan, busy: false } });

    for (const checkbox of wrapper.findAll('input[type="checkbox"]')) {
      const id = checkbox.attributes("id");
      expect(id).toBeTruthy();
      expect(wrapper.find(`label[for="${id}"]`).exists()).toBe(true);
    }
  });

  it("shows the error and keeps the dialog", () => {
    const wrapper = mount(UninstallDialog, {
      props: { plan, busy: false, error: "DependentMod depends on ModuleManager and must be removed too." },
    });

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').text()).toContain("DependentMod depends on ModuleManager");
  });

  it("disables the buttons while busy and emits cancel", async () => {
    const busy = mount(UninstallDialog, { props: { plan, busy: true } });
    const uninstallButton = busy.findAll("button").find((button) => button.text() === "Uninstalling…");
    expect(uninstallButton?.attributes("disabled")).toBeDefined();

    const idle = mount(UninstallDialog, { props: { plan, busy: false } });
    await clickButton(idle, "Cancel");
    expect(idle.emitted("cancel")).toEqual([[]]);
  });

  it("resets the orphan selection when the plan changes", async () => {
    const wrapper = mount(UninstallDialog, { props: { plan, busy: false } });
    await wrapper.find('input[value="O2"]').setValue(false);

    await wrapper.setProps({ plan: { ...plan, orphans: [...plan.orphans] } });
    await clickButton(wrapper, "Uninstall");

    expect(wrapper.emitted("confirm")).toEqual([[["DependentMod", "O1", "O2"]]]);
  });

  it("moves focus into the dialog, traps Tab and restores focus on close", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const wrapper = mount(UninstallDialog, { props: { plan, busy: false }, attachTo: document.body });

    const buttons = wrapper.findAll("button");
    const cancel = buttons.find((button) => button.text() === "Cancel");
    expect(document.activeElement).toBe(cancel?.element);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    const firstCheckbox = wrapper.find('input[type="checkbox"]').element;
    expect(document.activeElement).toBe(firstCheckbox);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cancel?.element);

    wrapper.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("cancels on Escape without letting the key reach dialogs underneath", async () => {
    const underneath: string[] = [];
    const listener = (event: KeyboardEvent) => underneath.push(event.key);
    window.addEventListener("keydown", listener);
    const wrapper = mount(UninstallDialog, { props: { plan, busy: false }, attachTo: document.body });

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(wrapper.emitted("cancel")).toEqual([[]]);
    expect(underneath).toEqual([]);

    await wrapper.setProps({ busy: true });
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(wrapper.emitted("cancel")).toEqual([[]]);

    wrapper.unmount();
    window.removeEventListener("keydown", listener);
  });
});
