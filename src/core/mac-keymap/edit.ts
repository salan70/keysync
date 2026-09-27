/**
 * `MacKeymapDocument` の意味単位の編集操作。
 *
 * Semantic Core は React、filesystem、WebHID の詳細から独立させる（AGENTS.md）。
 *
 * `src/core/model/edit.ts` と同じ思想で、keycode は正規化せず渡された表記のまま置き、
 * 妥当性の判定は `validateMacKeymap` に委ねる（ADR 0025）。Vial 側と違い layers は
 * 疎な map なので「範囲外」という概念が無く、無い layer への書き込みは layer を作る。
 */

import {
  isMacFlowTapTerm,
  isMacTappingTerm,
  MAC_FLOW_TAP_TERM_RANGE,
  MAC_TAPPING_TERM_RANGE,
  type MacDeviceIdentifier,
  type MacKeymapDocument,
  type MacLayerAssignments,
} from "./types.ts";

/** 編集操作の入力が成立しないときに投げる。 */
export class MacKeymapEditError extends Error {}

function withLayer(
  document: MacKeymapDocument,
  layer: number,
  assignments: MacLayerAssignments,
): MacKeymapDocument {
  const layers = new Map(document.layers);
  layers.set(layer, assignments);
  return { ...document, layers };
}

function requireValidLayer(layer: number): void {
  if (!Number.isInteger(layer) || layer < 0) {
    throw new MacKeymapEditError(`layer は 0 以上の整数（${layer} が渡された）`);
  }
}

/**
 * `(layer, keyCode)` の割り当てを差し替える。layer が無ければ作る。
 *
 * 空文字は serialize / parse の前提を壊すため拒む。それ以外の表記の妥当性は
 * `validateMacKeymap` の責務。
 *
 * @doc docs/specs/mac-keymap.md#mac-edit
 */
export function setMacAssignment(
  document: MacKeymapDocument,
  layer: number,
  keyCode: string,
  keycode: string,
): MacKeymapDocument {
  requireValidLayer(layer);
  if (keyCode === "") throw new MacKeymapEditError("keyCode が空");
  if (keycode === "") throw new MacKeymapEditError("keycode が空");

  const assignments = new Map(document.layers.get(layer) ?? []);
  assignments.set(keyCode, keycode);
  return withLayer(document, layer, assignments);
}

/**
 * `(layer, keyCode)` の割り当てを外し、素通しへ戻す。
 *
 * `KC_NO`（イベントを捨てる）と削除（素通し）は別セマンティクスなので、削除は
 * この関数でしか表せない（ADR 0022 の疎な map）。空になった layer は残す。
 * 「割り当てを外したら layer が消える」という驚きを避けるためで、layer の削除は
 * 独立した操作にする。
 *
 * @doc docs/specs/mac-keymap.md#mac-edit
 */
export function clearMacAssignment(
  document: MacKeymapDocument,
  layer: number,
  keyCode: string,
): MacKeymapDocument {
  const current = document.layers.get(layer);
  if (current === undefined || !current.has(keyCode)) return document;

  const assignments = new Map(current);
  assignments.delete(keyCode);
  return withLayer(document, layer, assignments);
}

/**
 * 空の layer を追加する。既にあれば何もしない。
 *
 * @doc docs/specs/mac-keymap.md#mac-edit
 */
export function addMacLayer(document: MacKeymapDocument, layer: number): MacKeymapDocument {
  requireValidLayer(layer);
  if (document.layers.has(layer)) return document;
  return withLayer(document, layer, new Map());
}

/** 2 つの識別子が同じデバイスを指すか。内蔵は 1 種類しか無いので種別だけで決まる。 */
function sameDevice(left: MacDeviceIdentifier, right: MacDeviceIdentifier): boolean {
  if ("builtIn" in left || "builtIn" in right) return "builtIn" in left && "builtIn" in right;
  return left.vendorId === right.vendorId && left.productId === right.productId;
}

/**
 * 適用先デバイスを追加する。既にあれば何もしない。
 *
 * 順序は追加順のまま保つ。`device_if` の identifiers は OR なので意味は順序に依存しないが、
 * 並べ替えると diff が動く。
 *
 * @doc docs/specs/mac-keymap.md#mac-edit
 */
export function addMacDevice(
  document: MacKeymapDocument,
  device: MacDeviceIdentifier,
): MacKeymapDocument {
  if (!("builtIn" in device)) {
    for (const value of [device.vendorId, device.productId]) {
      if (!Number.isInteger(value) || value < 0) {
        throw new MacKeymapEditError(
          `vendor_id / product_id は 0 以上の整数（${value} が渡された）`,
        );
      }
    }
  }
  if (document.devices.some((existing) => sameDevice(existing, device))) return document;
  return { ...document, devices: [...document.devices, device] };
}

/**
 * mod-tap の tap と hold を分ける閾値（ms）を変える。範囲外は拒む（ADR 0044）。
 *
 * @doc docs/specs/mac-keymap.md#mac-edit
 */
export function setMacTappingTerm(
  document: MacKeymapDocument,
  tappingTermMs: number,
): MacKeymapDocument {
  if (!isMacTappingTerm(tappingTermMs)) {
    throw new MacKeymapEditError(
      `tapping term は ${MAC_TAPPING_TERM_RANGE.min}〜${MAC_TAPPING_TERM_RANGE.max} ms の整数（${tappingTermMs} が渡された）`,
    );
  }
  if (document.tappingTermMs === tappingTermMs) return document;
  return { ...document, tappingTermMs };
}

/**
 * Flow Tap の閾値（ms）を変える。0 は無効。範囲外は拒む（ADR 0047）。
 *
 * @doc docs/specs/mac-keymap.md#mac-edit
 */
export function setMacFlowTapTerm(
  document: MacKeymapDocument,
  flowTapTermMs: number,
): MacKeymapDocument {
  if (!isMacFlowTapTerm(flowTapTermMs)) {
    throw new MacKeymapEditError(
      `flow tap term は ${MAC_FLOW_TAP_TERM_RANGE.min}〜${MAC_FLOW_TAP_TERM_RANGE.max} ms の整数（${flowTapTermMs} が渡された）`,
    );
  }
  if (document.flowTapTermMs === flowTapTermMs) return document;
  return { ...document, flowTapTermMs };
}
