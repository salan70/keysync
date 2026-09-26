/**
 * desired state → `linux-keyboard.<layout>.yaml` テキスト。
 *
 * 並べ方と並び順は `serializeMacKeymapYaml` と同じ。layer 昇順・`key_code` 名昇順で固定する。
 */

import { LINUX_KEYMAP_SCHEMA, type LinuxKeymapDocument } from "./types.ts";

/** @doc docs/specs/linux-keymap.md#serializelinuxkeymapyaml */
export function serializeLinuxKeymapYaml(document: LinuxKeymapDocument): string {
  const lines = [
    `schema: ${LINUX_KEYMAP_SCHEMA}`,
    `layout: ${document.layout}`,
    "devices:",
    ...document.devices.map(
      (device) => `  - { vendor_id: ${device.vendorId}, product_id: ${device.productId} }`,
    ),
    "layers:",
  ];
  for (const [layer, assignments] of [...document.layers.entries()].sort(([a], [b]) => a - b)) {
    lines.push(`  ${layer}:`);
    for (const [keyCode, keycode] of [...assignments.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      lines.push(`    ${JSON.stringify(keyCode)}: ${JSON.stringify(keycode)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
