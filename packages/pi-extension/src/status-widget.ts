import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

/** Render the live editor context immediately above the input, aligned right. */
export function createStatusWidget(label: string): (_tui: TUI, theme: Theme) => Component {
  return (_tui, theme) => ({
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const text = truncateToWidth(label, width, "...");
      const padding = " ".repeat(Math.max(0, width - visibleWidth(text)));
      return [padding + theme.fg("dim", text)];
    },
  });
}
