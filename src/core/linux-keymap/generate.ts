/**
 * desired state → keyd の設定ファイル（`/etc/keyd/keysync.conf`）。
 *
 * 展開規則は ADR 0042。落とせない keycode は Mac 側と同じく黙って捨てず、error の
 * diagnostic にする。keyd は書かれていないキーを `main` へ落とすため、捨てると
 * 「効かないキー」として静かに残る。
 */

import { classifyKeycode } from "../validation/keycode-vocabulary.ts";
import { createDiagnostic, type Diagnostic } from "../validation/types.ts";
import { keydKeyName, keydModifierLayer, keydPositionName } from "./key-names.ts";
import type { LinuxDeviceIdentifier, LinuxKeymapDocument } from "./types.ts";

/** keyd の設定 1 section。`[ids]` は bindings の代わりに ids を持つ。 */
export interface KeydSection {
  readonly name: string;
  /** keyd のキー名 → action。並び順は生成時の順（位置の `key_code` 名昇順）。 */
  readonly bindings: readonly (readonly [string, string])[];
}

/** 生成結果。 */
export interface GeneratedKeydConfig {
  readonly ids: readonly string[];
  readonly sections: readonly KeydSection[];
  readonly text: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** layer n の section 名。layer 0 は keyd の既定 layer `main`。 */
export function keydLayerName(layer: number): string {
  return layer === 0 ? "main" : `layer${layer}`;
}

/** `[ids]` の 1 行。`k:` でキーボードだけを指す。trackpad と id を共有する機種があるため。 */
export function keydDeviceId(device: LinuxDeviceIdentifier): string {
  const hex = (value: number) => value.toString(16).padStart(4, "0");
  return `k:${hex(device.vendorId)}:${hex(device.productId)}`;
}

/**
 * desired state から keyd の設定を組み立てる。
 *
 * section は `[ids]`・`[main]`・`[layer<n>]`（n 昇順）の順に並べる。`MO` / `LT` / `TG` が
 * 指す layer は、割り当てが無くても空の section を出す。keyd は存在しない layer を指す
 * 設定を読み込まないが、Karabiner では変数が立つだけで何も起きないので、それと揃える。
 *
 * @doc docs/specs/linux-keymap.md#generatekeydconfig
 */
export function generateKeydConfig(
  document: LinuxKeymapDocument,
  source = "linux-keyboard.yaml",
): GeneratedKeydConfig {
  const diagnostics: Diagnostic[] = [];
  const base = document.layers.get(0);
  const referenced = new Set<number>();
  const sections = new Map<number, KeydSection>();

  for (const layer of [...document.layers.keys()].sort((a, b) => a - b)) {
    const assignments = document.layers.get(layer);
    if (assignments === undefined) continue;
    const bindings: (readonly [string, string])[] = [];
    const owners = new Map<string, string>();
    for (const keyCode of [...assignments.keys()].sort()) {
      const keycode = assignments.get(keyCode);
      if (keycode === undefined) continue;
      if (layer > 0 && base?.get(keyCode) === keycode) continue;
      const position = keydPositionName(keyCode);
      if (position === undefined) {
        diagnostics.push(
          unsupported(
            "linux-keymap/unsupported-position",
            layer,
            keyCode,
            keycode,
            `${keyCode} に対応する Linux のキーが無い`,
          ),
        );
        continue;
      }
      const action = actionFor(keyCode, keycode, layer, diagnostics, referenced);
      if (action === undefined) continue;
      const owner = owners.get(position);
      if (owner !== undefined) {
        diagnostics.push(
          unsupported(
            "linux-keymap/position-collision",
            layer,
            keyCode,
            keycode,
            `${keyCode} と ${owner} は Linux では同じキー（${position}）になる`,
          ),
        );
        continue;
      }
      owners.set(position, keyCode);
      bindings.push([position, action]);
    }
    sections.set(layer, { name: keydLayerName(layer), bindings });
  }
  for (const layer of referenced) {
    if (!sections.has(layer)) sections.set(layer, { name: keydLayerName(layer), bindings: [] });
  }
  if (!sections.has(0)) sections.set(0, { name: "main", bindings: [] });

  const ordered = [...sections.entries()].sort(([a], [b]) => a - b).map(([, section]) => section);
  const ids = document.devices.map(keydDeviceId);
  return { ids, sections: ordered, text: renderKeyd(ids, ordered, source), diagnostics };
}

/** `linuxKeycodeSupport` の判定結果。 */
export type LinuxKeycodeSupport =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * keycode を keyd へ落とせるか。`macKeycodeSupport` と同じく、判定を書き写さず
 * 実際の lowering を 1 キーで走らせて決める。
 *
 * @doc docs/specs/linux-keymap.md#linuxkeycodesupport
 */
export function linuxKeycodeSupport(keycode: string): LinuxKeycodeSupport {
  const diagnostics: Diagnostic[] = [];
  actionFor("spacebar", keycode, 0, diagnostics, new Set());
  const first = diagnostics[0];
  return first === undefined
    ? { ok: true }
    : { ok: false, code: first.code, message: first.message };
}

function renderKeyd(ids: readonly string[], sections: readonly KeydSection[], source: string) {
  const lines = [
    `# KeySync が ${source} から生成した keyd の設定。直接編集しない。`,
    "",
    "[ids]",
    "",
    ...ids,
  ];
  for (const section of sections) {
    lines.push("", `[${section.name}]`, "");
    for (const [key, action] of section.bindings) lines.push(`${key} = ${action}`);
  }
  return `${lines.join("\n")}\n`;
}

function unsupported(
  code: string,
  layer: number,
  keyCode: string,
  keycode: string,
  message: string,
): Diagnostic {
  return createDiagnostic(code, "error", { kind: "macKey", layer, keyCode }, message, {
    keyCode,
    keycode,
  });
}

/**
 * keycode 1 つを keyd の action にする。`undefined` は「書かない」。
 *
 * `KC_TRNS` は書かないことがそのまま正しい。keyd は書かれていないキーを下の layer へ
 * 落とす（ADR 0042）。
 */
function actionFor(
  keyCode: string,
  keycode: string,
  layer: number,
  diagnostics: Diagnostic[],
  referenced: Set<number>,
): string | undefined {
  const lexeme = classifyKeycode(keycode);
  const fail = (code: string, message: string) => {
    diagnostics.push(unsupported(code, layer, keyCode, keycode, message));
    return undefined;
  };

  switch (lexeme.kind) {
    case "transparent":
      return undefined;
    case "none":
      return "noop";
    case "basic":
      return (
        keydKeyName(lexeme.name) ??
        fail("linux-keymap/unsupported-keycode", `${keycode} に対応する keyd のキーが無い`)
      );
    case "layerSwitch": {
      if (lexeme.layer === 0) {
        return fail(
          "linux-keymap/unsupported-keycode",
          `${keycode} は layer 0 を指す。layer 0 は keyd の main なので切り替え先にできない`,
        );
      }
      const target = keydLayerName(lexeme.layer);
      if (lexeme.action === "momentary") {
        referenced.add(lexeme.layer);
        return `layer(${target})`;
      }
      if (lexeme.action === "toggle") {
        referenced.add(lexeme.layer);
        return `toggle(${target})`;
      }
      if (lexeme.action === "layerTap") {
        const inner = lexeme.inner === undefined ? undefined : keydKeyName(lexeme.inner);
        if (inner === undefined) {
          return fail(
            "linux-keymap/unsupported-layer-tap-inner",
            `${keycode} の tap 側を keyd のキーへ落とせない`,
          );
        }
        referenced.add(lexeme.layer);
        return `overload(${target}, ${inner})`;
      }
      return fail(
        "linux-keymap/unsupported-keycode",
        `${keycode} の layer 操作は keyd へ落とせない（対応するのは MO / LT / TG）`,
      );
    }
    case "modTap": {
      const modifier = keydModifierLayer(lexeme.modifier);
      const inner = keydKeyName(lexeme.inner);
      if (modifier === undefined || inner === undefined) {
        return fail(
          "linux-keymap/unsupported-mod-tap",
          `${keycode} を keyd の mod-tap へ落とせない`,
        );
      }
      return `overload(${modifier}, ${inner})`;
    }
    case "modified":
    case "oneShotMod":
    case "tapDance":
    case "macro":
    case "custom":
    case "numeric":
    case "unknown":
      return fail("linux-keymap/unsupported-keycode", `${keycode} は keyd へ落とせない`);
  }
}
