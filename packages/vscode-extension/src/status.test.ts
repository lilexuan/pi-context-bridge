import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { createStatusBarUpdater } from "./status.js";

describe("createStatusBarUpdater", () => {
  it("writes identical text and tooltip only once", () => {
    const setText = vi.fn();
    const setTooltip = vi.fn();
    const show = vi.fn();
    const target = { show } as unknown as Pick<vscode.StatusBarItem, "text" | "tooltip" | "show">;
    Object.defineProperties(target, {
      text: { set: setText },
      tooltip: { set: setTooltip },
    });
    const update = createStatusBarUpdater(target);

    update("Pi Context: note.json:1", "selection on");
    update("Pi Context: note.json:1", "selection on");
    update("Pi Context: note.json:1", "selection off");

    expect(setText).toHaveBeenCalledTimes(1);
    expect(setTooltip).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenCalledTimes(1);
  });
});
