import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { JobResponse } from "@kraken/contracts";
import InstallQueuePanel from "../src/components/InstallQueuePanel.vue";

const jobs: JobResponse[] = [
  {
    jobId: "job-active",
    kind: "install",
    identifier: "ModuleManager",
    version: "4.2.3",
    status: "running",
    phase: "downloading",
    message: "Downloading archive.",
    bytesReceived: 50,
    bytesTotal: 200,
  },
  {
    jobId: "job-unknown-total",
    kind: "install",
    identifier: "KerbalEngineer",
    status: "running",
    phase: "downloading",
    bytesReceived: 2048,
  },
  {
    jobId: "job-success",
    kind: "install",
    identifier: "ToolbarController",
    status: "succeeded",
    phase: "done",
    message: "Install complete.",
  },
  {
    jobId: "job-failure",
    kind: "install",
    identifier: "BrokenMod",
    status: "failed",
    phase: "failed",
    error: "Archive is corrupt.",
  },
];

describe("InstallQueuePanel", () => {
  it("renders independent progress and terminal states", () => {
    const wrapper = mount(InstallQueuePanel, { props: { jobs } });

    expect(wrapper.findAll("li")).toHaveLength(4);
    expect(wrapper.text()).toContain("ModuleManager");
    expect(wrapper.text()).toContain("4.2.3");
    expect(wrapper.text()).toContain("25%");
    expect(wrapper.text()).toContain("2.0 KB");
    expect(wrapper.text()).toContain("Installed");
    expect(wrapper.text()).toContain("Archive is corrupt.");

    const progress = wrapper.find('[data-job-id="job-active"] progress');
    expect(progress.attributes("value")).toBe("25");
    expect(progress.attributes("aria-label")).toBe("Install progress for ModuleManager");
    expect(wrapper.find('[data-job-id="job-unknown-total"] progress').attributes("value")).toBeUndefined();
    expect(wrapper.find('[data-job-id="job-active"] button').exists()).toBe(false);
  });

  it("only emits dismissal controls for terminal jobs and can clear finished jobs", async () => {
    const wrapper = mount(InstallQueuePanel, { props: { jobs } });

    await wrapper.find('button[aria-label="Dismiss BrokenMod install"]').trigger("click");
    expect(wrapper.emitted("dismiss")).toEqual([["job-failure"]]);

    const clearButton = wrapper.findAll("button").find((button) => button.text() === "Clear finished");
    expect(clearButton).toBeDefined();
    await clearButton!.trigger("click");
    expect(wrapper.emitted("clearFinished")).toEqual([[]]);
  });
});
