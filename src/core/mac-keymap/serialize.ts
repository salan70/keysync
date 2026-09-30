/**
 * desired state → `mac-keyboard.yaml` テキスト。
 *
 * `keymap.yaml` の serializer は物理配列の格子を diff へ残すために row を flow sequence で
 * 並べるが（ADR 0009）、こちらは疎な map なので格子が無い。並べ方は
 * `keysync/labels.yaml`（`src/workspace/labels.ts`）と同じく、section 見出しの下へ
 * `key: "value"` を 1 行ずつ置く形にする。
 *
 * 並び順は layer 昇順・`key_code` 名昇順で固定する。生成器が行を並べる順序と
 * 同じ規則にして、手で並べ替えても diff が動かないようにする。
 *
 */

import { MAC_KEYMAP_SCHEMA, type MacDeviceIdentifier, type MacKeymapDocument } from "./types.ts";

/** @doc docs/specs/mac-keymap.md#serializemackeymapyaml */
export function serializeMacKeymapYaml(document: MacKeymapDocument): string {
  // layout・devices・tapping_term_ms・flow_tap_term_ms は省略時の既定があっても常に書く。
  // 正規形は明示（ADR 0024・0026・0044・0047）。
  const lines = [
    `schema: ${MAC_KEYMAP_SCHEMA}`,
    `layout: ${document.layout}`,
    "devices:",
    ...document.devices.map((device) => `  - ${deviceFlow(device)}`),
    `tapping_term_ms: ${document.tappingTermMs}`,
    `flow_tap_term_ms: ${document.flowTapTermMs}`,
    "layers:",
  ];
  for (const [layer, assignments] of [...document.layers.entries()].sort(([a], [b]) => a - b)) {
    lines.push(`  ${layer}:`);
    for (const [keyCode, keycode] of [...assignments.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      lines.push(`    ${quote(keyCode)}: ${quote(keycode)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * device 1 個を 1 行の flow mapping にする。
 *
 * 疎な map を 1 行ずつ置くこの file の方針に合わせ、block mapping へは展開しない。
 * parser が受ける形もこの 2 形だけ（ADR 0026・0052）。
 */
function deviceFlow(device: MacDeviceIdentifier): string {
  return "builtIn" in device ? "{ built_in: true }" : `{ name: ${quote(device.name)} }`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}
