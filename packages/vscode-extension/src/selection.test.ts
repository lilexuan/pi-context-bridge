import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { planSelectionRead } from "./selection.js";

function position(offset: number): vscode.Position {
  return { line: 0, character: offset } as vscode.Position;
}

describe("planSelectionRead", () => {
  it("bounds large selections before their text is read", () => {
    const document = {
      offsetAt: vi.fn((value: vscode.Position) => value.character),
      positionAt: vi.fn((offset: number) => position(offset)),
    };
    const selection = {
      start: position(1_000),
      end: position(500_001_000),
    } as vscode.Selection;

    const plan = planSelectionRead(document, selection, 20_000);

    expect(plan).toEqual({
      end: position(21_000),
      originalCharacterCount: 500_000_000,
      truncated: true,
    });
    expect(document.positionAt).toHaveBeenCalledWith(21_000);
  });

  it("uses the original end for a selection below the limit", () => {
    const end = position(15);
    const document = {
      offsetAt: (value: vscode.Position) => value.character,
      positionAt: vi.fn(),
    };
    const selection = { start: position(10), end } as vscode.Selection;

    expect(planSelectionRead(document, selection, 20_000)).toEqual({
      end,
      originalCharacterCount: 5,
      truncated: false,
    });
    expect(document.positionAt).not.toHaveBeenCalled();
  });
});
