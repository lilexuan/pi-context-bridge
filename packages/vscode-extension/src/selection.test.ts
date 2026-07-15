import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import {
  DEFAULT_MAXIMUM_SELECTION_CHARACTERS,
  HARD_MAXIMUM_SELECTION_CHARACTERS,
  planSelectionRead,
} from "./selection.js";

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

  it.each([
    ["an omitted value", undefined],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
  ])("uses the 20k default for %s", (_label, maximumCharacters) => {
    const document = {
      offsetAt: (value: vscode.Position) => value.character,
      positionAt: (offset: number) => position(offset),
    };
    const selection = { start: position(1_000), end: position(500_000) } as vscode.Selection;

    expect(planSelectionRead(document, selection, maximumCharacters)).toEqual({
      end: position(1_000 + DEFAULT_MAXIMUM_SELECTION_CHARACTERS),
      originalCharacterCount: 499_000,
      truncated: true,
    });
  });

  it("hard-caps oversized configured values at 200k", () => {
    const document = {
      offsetAt: (value: vscode.Position) => value.character,
      positionAt: (offset: number) => position(offset),
    };
    const selection = { start: position(5_000), end: position(500_000_000) } as vscode.Selection;

    expect(planSelectionRead(document, selection, 500_000_000)).toEqual({
      end: position(5_000 + HARD_MAXIMUM_SELECTION_CHARACTERS),
      originalCharacterCount: 499_995_000,
      truncated: true,
    });
  });

  it("clamps negative configured values to zero", () => {
    const document = {
      offsetAt: (value: vscode.Position) => value.character,
      positionAt: (offset: number) => position(offset),
    };
    const selection = { start: position(10), end: position(20) } as vscode.Selection;

    expect(planSelectionRead(document, selection, -1)).toEqual({
      end: position(10),
      originalCharacterCount: 10,
      truncated: true,
    });
  });
});
