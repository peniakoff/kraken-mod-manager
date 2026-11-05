import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DependencyPromptDialog, { type DependencyPrompt } from "../src/components/DependencyPromptDialog.vue";

const target = { identifier: "Scansat", name: "SCANsat", version: "20.4" };
const mod = { ...target, authors: ["DMagic"], tags: ["plugin"], provides: [] };

function prompt(overrides: Partial<DependencyPrompt> = {}): DependencyPrompt {
  return {
    mod,
    choices: {},
    plan: {
      status: "ok",
      target,
      toInstall: [target],
      alreadySatisfied: [],
      conflicts: [],
      unmet: [],
      optional: [],
      choices: [],
    },
    offered: [
      {
        kind: "recommends",
        name: "ModuleManager",
        requiredBy: "Scansat",
        module: { identifier: "ModuleManager", name: "Module Manager", version: "4.2.3" },
      },
      {
        kind: "suggests",
        name: "KER",
        requiredBy: "Scansat",
        module: { identifier: "KER", name: "Kerbal Engineer", version: "1.1.9" },
      },
    ],
    selected: ["ModuleManager"],
    ...overrides,
  };
}

function checkbox(wrapper: ReturnType<typeof mount>, identifier: string) {
  return wrapper.get<HTMLInputElement>(`input[type="checkbox"][value="${identifier}"]`);
}

describe("DependencyPromptDialog optional mods", () => {
  it("groups recommended and suggested mods with the recommended ones picked", () => {
    const wrapper = mount(DependencyPromptDialog, { props: { prompt: prompt() } });

    const legends = wrapper.findAll("legend").map((legend) => legend.text());
    expect(legends).toEqual(["Recommended", "Suggested"]);
    expect(checkbox(wrapper, "ModuleManager").element.checked).toBe(true);
    expect(checkbox(wrapper, "KER").element.checked).toBe(false);
    expect(wrapper.text()).toContain("Kerbal Engineer");
    expect(wrapper.text()).toContain("1.1.9");
  });

  it("asks to install the mod itself when it has no missing dependencies", () => {
    const wrapper = mount(DependencyPromptDialog, { props: { prompt: prompt() } });

    expect(wrapper.get("h2").text()).toBe("Install SCANsat?");
    expect(wrapper.findAll("button").map((button) => button.text())).toEqual(["Install", "Cancel"]);
  });

  it("emits the picked optional mods on confirm", async () => {
    const wrapper = mount(DependencyPromptDialog, { props: { prompt: prompt() } });

    await checkbox(wrapper, "ModuleManager").setValue(false);
    await checkbox(wrapper, "KER").setValue(true);
    await wrapper.findAll("button").find((button) => button.text() === "Install")!.trigger("click");

    expect(wrapper.emitted("confirm")).toEqual([[["KER"]]]);
  });

  it("lists required dependencies above the optional mods", async () => {
    const dependency = { identifier: "SCANsatLib", name: "SCANsat Lib", version: "1.0" };
    const wrapper = mount(DependencyPromptDialog, {
      props: { prompt: prompt({ plan: { ...prompt().plan, toInstall: [dependency, target] } }) },
    });

    expect(wrapper.get("h2").text()).toBe("Install required dependencies?");
    expect(wrapper.text()).toContain("SCANsat requires SCANsat Lib");
    await wrapper.findAll("button").find((button) => button.text() === "Install automatically")!.trigger("click");
    expect(wrapper.emitted("confirm")).toEqual([[["ModuleManager"]]]);
  });

  it("names the mod a recommendation comes from when it is not the target", () => {
    const wrapper = mount(DependencyPromptDialog, {
      props: {
        prompt: prompt({
          plan: {
            ...prompt().plan,
            toInstall: [{ identifier: "SCANsatLib", name: "SCANsat Lib", version: "1.0" }, target],
          },
          offered: [
            {
              kind: "recommends",
              name: "Toolbar",
              requiredBy: "SCANsatLib",
              module: { identifier: "Toolbar", name: "Toolbar", version: "1.8" },
            },
          ],
          selected: [],
        }),
      },
    });

    expect(wrapper.get('label[for="optional-Toolbar"]').text()).toContain("for SCANsat Lib");
  });
});
