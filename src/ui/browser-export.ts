import type { KeyboardDefinition } from "../core/definition/types.ts";
import { generateKanataConfig } from "../core/mac-keymap/kanata/generate.ts";
import { parseMacKeymapYaml } from "../core/mac-keymap/parse.ts";
import type { MacKeymapDocument } from "../core/mac-keymap/types.ts";
import { validateMacKeymap } from "../core/mac-keymap/validate.ts";
import type { Diagnostic, DiagnosticSummary } from "../core/validation/types.ts";
import { parseVil } from "../core/vil/parse.ts";
import { serializeVil } from "../core/vil/serialize.ts";
import { renderPdf, renderSvg } from "../render/keyboard.ts";
import type { WorkspaceLabels } from "../workspace/labels.ts";
import type { VilDocument } from "../core/vil/types.ts";

/** @doc docs/specs/ui.md#browser-import-export */
export function parseBrowserVil(text: string): VilDocument {
  return parseVil(text);
}

/** @doc docs/specs/ui.md#browser-import-export */
export function serializeBrowserVil(document: VilDocument): string {
  return serializeVil(document);
}

/** @doc docs/specs/ui.md#browser-import-export */
export function renderBrowserSvg(
  document: VilDocument,
  definition: KeyboardDefinition,
  layer: number,
  labels: WorkspaceLabels,
): string {
  return renderSvg(document, definition, {
    layer,
    labels,
    title: `${definition.name} / layer ${layer}`,
  });
}

/** @doc docs/specs/ui.md#browser-import-export */
export function renderBrowserPdf(
  document: VilDocument,
  definition: KeyboardDefinition,
  layer: number,
  labels: WorkspaceLabels,
): Uint8Array {
  return renderPdf(document, definition, {
    layer,
    labels,
    title: `${definition.name} / layer ${layer}`,
  });
}

/**
 * `mac-keyboard.yaml` から kanata の設定を組み立てる。
 *
 * error が 1 件でもあれば `config` は `undefined` にする。書き出す前に落とせないことが
 * 分かった時点で止める（ADR 0023・0049）。
 *
 * @doc docs/specs/ui.md#browser-import-export
 */
export function generateBrowserKanata(text: string): {
  readonly config: string | undefined;
  readonly diagnostics: readonly Diagnostic[];
  readonly summary: DiagnosticSummary;
} {
  return generateBrowserKanataFromDocument(parseMacKeymapYaml(text));
}

/**
 * UI 状態の `MacKeymapDocument` から直接 kanata の設定を組み立てる。
 *
 * 盤面編集が載った後の書き出しはこちらが正。ディスクを再読すると保存キューに
 * 未 flush の編集がある瞬間に古い内容を書き出しうるため、in-memory の document
 * から生成する（ADR 0025）。
 *
 * @doc docs/specs/ui.md#browser-import-export
 */
export function generateBrowserKanataFromDocument(document: MacKeymapDocument): {
  readonly config: string | undefined;
  readonly diagnostics: readonly Diagnostic[];
  readonly summary: DiagnosticSummary;
} {
  const { diagnostics, summary } = validateMacKeymap(document);
  if (summary.error > 0) return { config: undefined, diagnostics, summary };
  return { config: generateKanataConfig(document).text, diagnostics, summary };
}
