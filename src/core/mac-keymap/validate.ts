/**
 * `mac-keyboard.yaml` の検証。
 *
 * `validation/validate.ts` の `validateKeymap` は `VilDocument` と `KeyboardDefinition` を
 * 前提にするため使えない。合成の入口を Mac 側に別途置く（ADR 0022）。
 *
 * severity の判定規則は ADR 0010 のまま。Karabiner へ落とせず**機能そのものが無くなる**
 * ものは error、割り当てが 1 件単位で静かに失われるもの（宣言した配列に無い from キーは
 * 決して発火しない）は warning、情報が保持されていて判断をユーザーへ委ねられるもの
 * （unreachable-layer）は information にする（ADR 0024）。
 *
 */

import { analyzeLayerGraph } from "../validation/reachability.ts";
import {
  createDiagnostic,
  summarize,
  type Diagnostic,
  type DiagnosticSummary,
} from "../validation/types.ts";
import { classifyKeycode } from "../validation/keycode-vocabulary.ts";
import { generateKanataConfig } from "./kanata/generate.ts";
import { KARABINER_POSITIONS, LAYOUT_MISSING_POSITIONS } from "./key-codes.ts";
import type { MacKeymapDocument } from "./types.ts";

/**
 * 位置と layer の検証が見る範囲。Linux の設定（ADR 0042）も同じ語彙なので共有する。
 */
export type KeymapBody = Pick<MacKeymapDocument, "layout" | "layers">;

/** 診断 code の接頭辞。Mac と Linux で分ける。 */
export type DiagnosticNamespace = "mac-keymap" | "linux-keymap";

/** 検証の結果。 */
export interface MacValidationResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly summary: DiagnosticSummary;
}

/**
 * desired state を検証する。表現可能性・位置・到達性をまとめて見る。
 *
 * @doc docs/specs/mac-keymap.md#validatemackeymap
 */
export function validateMacKeymap(document: MacKeymapDocument): MacValidationResult {
  const diagnostics: Diagnostic[] = [
    ...emptyDevices(document),
    ...unknownPositions(document),
    ...positionsNotOnLayout(document),
    ...unknownLayers(document),
    // 表現可能性は kanata の生成器が判定する。落とせないものは書かずに error を積む（ADR 0049）。
    ...generateKanataConfig(document).diagnostics,
    ...unreachableLayers(document),
  ];
  return { diagnostics, summary: summarize(diagnostics) };
}

/**
 * 適用先デバイスが 1 つも無い設定。
 *
 * 適用先が空だと、kanata はどのキーボードも掴まない。書いた割り当てが
 * 1 件残らず効かなくなるので error（ADR 0010 の「機能そのものが無くなる」）。
 */
function emptyDevices(document: MacKeymapDocument): readonly Diagnostic[] {
  if (document.devices.length > 0) return [];
  return [
    createDiagnostic(
      "mac-keymap/no-target-device",
      "error",
      { kind: "document" },
      "devices が空なので、どのキーボードにも適用されない",
    ),
  ];
}

/** 位置の語彙（Karabiner の `key_code` 名）に無い位置。生成器が書けないので error。 */
export function unknownPositions(
  document: KeymapBody,
  namespace: DiagnosticNamespace = "mac-keymap",
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [layer, assignments] of [...document.layers.entries()].sort(([a], [b]) => a - b)) {
    for (const keyCode of [...assignments.keys()].sort()) {
      if (KARABINER_POSITIONS.has(keyCode)) continue;
      diagnostics.push(
        createDiagnostic(
          `${namespace}/unknown-position`,
          "error",
          { kind: "macKey", layer, keyCode },
          `${keyCode} は Karabiner の key_code に無い`,
          { keyCode },
        ),
      );
    }
  }
  return diagnostics;
}

/**
 * 宣言した物理配列に存在しない位置。設定としては読み込まれるが、そのキーが
 * 押せないため割り当てが決して発火しない。割り当てが 1 件単位で静かに失われるので
 * warning（ADR 0024）。`KARABINER_POSITIONS` に無いものは `unknown-position` が error で
 * 報告済みなので見ない（`LAYOUT_MISSING_POSITIONS` は部分集合）。
 */
export function positionsNotOnLayout(
  document: KeymapBody,
  namespace: DiagnosticNamespace = "mac-keymap",
): readonly Diagnostic[] {
  const missing = LAYOUT_MISSING_POSITIONS.get(document.layout);
  if (missing === undefined || missing.size === 0) return [];
  const diagnostics: Diagnostic[] = [];
  for (const [layer, assignments] of [...document.layers.entries()].sort(([a], [b]) => a - b)) {
    for (const keyCode of [...assignments.keys()].sort()) {
      if (!missing.has(keyCode)) continue;
      diagnostics.push(
        createDiagnostic(
          `${namespace}/position-not-on-layout`,
          "warning",
          { kind: "macKey", layer, keyCode },
          `${keyCode} は ${document.layout} 配列の内蔵キーボードに無い`,
          { keyCode, layout: document.layout },
        ),
      );
    }
  }
  return diagnostics;
}

/** 書かれていない layer を指す `MO` / `LT` / `TG`。切り替えても割り当てが無い。 */
export function unknownLayers(
  document: KeymapBody,
  namespace: DiagnosticNamespace = "mac-keymap",
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [layer, assignments] of [...document.layers.entries()].sort(([a], [b]) => a - b)) {
    for (const keyCode of [...assignments.keys()].sort()) {
      const keycode = assignments.get(keyCode);
      if (keycode === undefined) continue;
      const lexeme = classifyKeycode(keycode);
      if (lexeme.kind !== "layerSwitch" || document.layers.has(lexeme.layer)) continue;
      diagnostics.push(
        createDiagnostic(
          `${namespace}/unknown-layer`,
          "warning",
          { kind: "macKey", layer, keyCode },
          `${keycode} が指す layer ${lexeme.layer} は書かれていない`,
          { keyCode, keycode, target: lexeme.layer },
        ),
      );
    }
  }
  return diagnostics;
}

/**
 * layer 0 から辿り着けない layer。
 *
 * severity は Vial 側の `reachability/unreachable-layer` と揃えて information にする。
 * 書けば書いたとおりに rule へ入り、失われる値も無い（ADR 0010）。
 *
 * Vial 側の `trapped-layer` はここでは見ない。Mac（kanata）は押している間だけ効く `MO` / `LT`
 * だけを扱うので、離せば必ず戻る。Linux（keyd）の `TG` の出口はここでは判定しない。
 */
export function unreachableLayers(
  document: KeymapBody,
  namespace: DiagnosticNamespace = "mac-keymap",
): readonly Diagnostic[] {
  const graph = analyzeLayerGraph(
    new Map(
      [...document.layers.entries()].map(([layer, assignments]) => [
        layer,
        [...assignments.values()],
      ]),
    ),
  );
  const empty = new Set(graph.emptyLayers);
  const diagnostics: Diagnostic[] = [];
  for (const layer of [...document.layers.keys()].sort((a, b) => a - b)) {
    if (layer === 0 || graph.reachable.has(layer) || empty.has(layer)) continue;
    diagnostics.push(
      createDiagnostic(
        `${namespace}/unreachable-layer`,
        "information",
        { kind: "layer", layer },
        `layer ${layer} に割り当てがあるが、layer 0 から辿り着く keycode が無い`,
        { layer },
      ),
    );
  }
  return diagnostics;
}
