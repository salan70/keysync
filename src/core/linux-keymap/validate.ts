/**
 * `linux-keyboard.<layout>.yaml` の検証。
 *
 * 位置と layer の検証は語彙が同じなので Mac 側の実装を共有し、診断 code の接頭辞だけを
 * `linux-keymap/` に変える（ADR 0042）。表現可能性は keyd の生成器が判定する。
 */

import {
  positionsNotOnLayout,
  unknownLayers,
  unknownPositions,
  unreachableLayers,
  type MacValidationResult,
} from "../mac-keymap/validate.ts";
import { createDiagnostic, summarize, type Diagnostic } from "../validation/types.ts";
import { generateKeydConfig } from "./generate.ts";
import type { LinuxKeymapDocument } from "./types.ts";

/**
 * desired state を検証する。
 *
 * @doc docs/specs/linux-keymap.md#validatelinuxkeymap
 */
export function validateLinuxKeymap(document: LinuxKeymapDocument): MacValidationResult {
  const unknown = unknownPositions(document, "linux-keymap");
  // 語彙に無い位置は unknown-position で報告済み。生成器の unsupported-position を重ねない。
  const reported = new Set(
    unknown.flatMap((diagnostic) =>
      diagnostic.subject.kind === "macKey" ? [diagnostic.subject.keyCode] : [],
    ),
  );
  const generated = generateKeydConfig(document).diagnostics.filter(
    (diagnostic) =>
      diagnostic.code !== "linux-keymap/unsupported-position" ||
      diagnostic.subject.kind !== "macKey" ||
      !reported.has(diagnostic.subject.keyCode),
  );
  const diagnostics: Diagnostic[] = [
    ...emptyDevices(document),
    ...unknown,
    ...positionsNotOnLayout(document, "linux-keymap"),
    ...unknownLayers(document, "linux-keymap"),
    ...generated,
    ...unreachableLayers(document, "linux-keymap"),
  ];
  return { diagnostics, summary: summarize(diagnostics) };
}

/**
 * 適用先デバイスが 1 つも無い設定。keyd は `[ids]` が空だとどのデバイスにも効かない。
 * 書いた割り当てが 1 件残らず効かないので error（ADR 0010 の「機能そのものが無くなる」）。
 */
function emptyDevices(document: LinuxKeymapDocument): readonly Diagnostic[] {
  if (document.devices.length > 0) return [];
  return [
    createDiagnostic(
      "linux-keymap/no-target-device",
      "error",
      { kind: "document" },
      "devices が空なので、どのキーボードにも適用されない。keysync linux devices で登録する",
    ),
  ];
}
