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
  {
    jobId: "job-queued",
    kind: "install",
    identifier: "Example",
    name: "Example Mod",
    version: "1.0",
    status: "queued",
    phase: "queued",
  },
  {
    jobId: "job-uninstall",
    kind: "uninstall",
    identifier: "Kopernicus",
    name: "Kopernicus Continued",
    status: "running",
    phase: "installing",
    alsoRemove: ["A", "B"],
  },
];

describe("InstallQueuePanel", () => {
  it("renders independent progress and terminal states", () => {
    const wrapper = mount(InstallQueuePanel, { props: { jobs } });

    expect(wrapper.findAll("li")).toHaveLength(6);
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

  it("labels install and uninstall entries", () => {
    const wrapper = mount(InstallQueuePanel, { props: { jobs } });

    expect(wrapper.attributes("aria-label")).toBe("Queue");
    expect(wrapper.find('[data-job-id="job-queued"]').text()).toContain("Install Example Mod 1.0");
    expect(wrapper.find('[data-job-id="job-queued"]').text()).toContain("Queued");
    expect(wrapper.find('[data-job-id="job-uninstall"]').text()).toContain("Uninstall Kopernicus Continued (+2 more)");
    // Jobs without a name fall back to the identifier.
    expect(wrapper.find('[data-job-id="job-active"]').text()).toContain("Install ModuleManager 4.2.3");
  });

  it("offers Remove only on queued entries and emits remove", async () => {
    const wrapper = mount(InstallQueuePanel, { props: { jobs } });

    expect(wrapper.find('[data-job-id="job-active"] button').exists()).toBe(false);
    expect(wrapper.find('[data-job-id="job-uninstall"] button').exists()).toBe(false);
    const remove = wrapper.find('[data-job-id="job-queued"] button');
    expect(remove.text()).toBe("Remove");
    expect(remove.attributes("aria-label")).toBe("Remove Install Example Mod 1.0 from the queue");
    await remove.trigger("click");
    expect(wrapper.emitted("remove")).toEqual([["job-queued"]]);
  });

  it("shows a waiting note and no progress bar for queued entries", () => {
    const wrapper = mount(InstallQueuePanel, { props: { jobs } });

    const queued = wrapper.find('[data-job-id="job-queued"]');
    expect(queued.text()).toContain("Waiting for earlier jobs to finish.");
    expect(queued.text().match(/Queued/g)).toHaveLength(1);
    expect(queued.find("progress").exists()).toBe(false);
    expect(wrapper.find('[data-job-id="job-active"] progress').attributes("aria-label")).toBe(
      "Install progress for ModuleManager",
    );
    expect(wrapper.find('[data-job-id="job-uninstall"] progress').attributes("aria-label")).toBe(
      "Uninstall progress for Kopernicus Continued",
    );
  });

  it("only emits dismissal controls for terminal jobs and can clear finished jobs", async () => {
    const wrapper = mount(InstallQueuePanel, { props: { jobs } });

    await wrapper.find('button[aria-label="Dismiss Install BrokenMod"]').trigger("click");
    expect(wrapper.emitted("remove")).toEqual([["job-failure"]]);

    const clearButton = wrapper.findAll("button").find((button) => button.text() === "Clear finished");
    expect(clearButton).toBeDefined();
    await clearButton!.trigger("click");
    expect(wrapper.emitted("clearFinished")).toEqual([[]]);
  });
});
