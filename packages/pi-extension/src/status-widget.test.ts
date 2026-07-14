import { describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { createStatusWidget } from "./status-widget.js";

const theme = { fg: vi.fn((_color: string, text: string) => text) } as unknown as Theme;

describe("status widget", () => {
  it("right-aligns the VS Code context above the editor", () => {
    const widget = createStatusWidget("VS Code: app.ts cursor 7:1")({} as TUI, theme);

    expect(widget.render(32)).toEqual(["      VS Code: app.ts cursor 7:1"]);
  });

  it("truncates cleanly in narrow terminals", () => {
    const widget = createStatusWidget("VS Code: packages/protocol/src/index.ts 11:14-11:33")({} as TUI, theme);
    const line = widget.render(24)[0];

    expect(line).toBeDefined();
    expect(visibleWidth(line!)).toBe(24);
    expect(line).toContain("...");
  });
});
