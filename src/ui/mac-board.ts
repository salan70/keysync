/**
 * Mac 盤面描画の entry 構築。React に依存しない純関数。
 *
 * 盤面は物理配列（`macPhysicalLayout`）を正として全キーを並べ、desired state の
 * 割り当てを重ねる。YAML にだけ存在する位置（盤面に無い from）はここでは扱わず、
 * `validateMacKeymap` の診断に委ねる（ADR 0025）。
 */

import { macPhysicalLayout, type MacPhysicalKey } from "../core/mac-keymap/physical-layout.ts";
import type { MacKeymapDocument } from "../core/mac-keymap/types.ts";

/** 盤面キー 1 個の描画 entry。`keycode` が `undefined` のキーは layer 0 なら素通し、layer 1 以上なら割り当てなし。 */
export interface MacBoardEntry {
  readonly keyCode: string;
  readonly physical: MacPhysicalKey;
  readonly keycode: string | undefined;
}

/** @doc docs/specs/ui.md#mac-board */
export function macBoardEntries(
  document: MacKeymapDocument,
  layer: number,
): readonly MacBoardEntry[] {
  const assignments = document.layers.get(layer);
  return macPhysicalLayout(document.layout).map((physical) => ({
    keyCode: physical.keyCode,
    physical,
    keycode: assignments?.get(physical.keyCode),
  }));
}

/** layer chip の並び。疎な layer 番号を昇順で返す。 */
export function macLayerNumbers(document: MacKeymapDocument): readonly number[] {
  return [...document.layers.keys()].sort((left, right) => left - right);
}

/** 「+」chip が作る次の layer 番号。 */
export function nextMacLayer(document: MacKeymapDocument): number {
  const numbers = macLayerNumbers(document);
  const last = numbers[numbers.length - 1];
  return last === undefined ? 0 : last + 1;
}
