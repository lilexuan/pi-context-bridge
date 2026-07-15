import type * as vscode from "vscode";

type OffsetDocument = Pick<vscode.TextDocument, "offsetAt" | "positionAt">;

export interface SelectionReadPlan {
  end: vscode.Position;
  originalCharacterCount: number;
  truncated: boolean;
}

/**
 * Calculates a bounded range before TextDocument#getText is called. This is
 * important because truncating the returned string would first allocate the
 * entire selection, which can be hundreds of megabytes for a large file.
 */
export function planSelectionRead(
  document: OffsetDocument,
  selection: vscode.Selection,
  maximumCharacters: number,
): SelectionReadPlan {
  const startOffset = document.offsetAt(selection.start);
  const endOffset = document.offsetAt(selection.end);
  const originalCharacterCount = Math.max(0, endOffset - startOffset);
  const limit = Math.max(0, Math.floor(maximumCharacters));
  const truncated = originalCharacterCount > limit;
  return {
    end: truncated ? document.positionAt(startOffset + limit) : selection.end,
    originalCharacterCount,
    truncated,
  };
}
