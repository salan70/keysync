/**
 * `LinuxKeymapDocument` の編集操作のうち、Linux 固有のもの。
 *
 * layer と割り当ての編集は Mac 側と同じ形なので、ここには適用先デバイスの追加だけを置く。
 */

import type { MacKeyboardLayout } from "../mac-keymap/types.ts";
import type { LinuxDeviceIdentifier, LinuxKeymapDocument } from "./types.ts";

/**
 * 作成時の初期状態。適用先は空で、`linux-keymap/no-target-device` が登録を促す。
 *
 * @doc docs/specs/linux-keymap.md#linux-edit
 */
export function initialLinuxKeymap(layout: MacKeyboardLayout): LinuxKeymapDocument {
  return { layout, devices: [], layers: new Map([[0, new Map()]]) };
}

/**
 * 適用先デバイスを追加する。既にあれば何もしない。順序は追加順のまま保つ。
 *
 * @doc docs/specs/linux-keymap.md#linux-edit
 */
export function addLinuxDevice(
  document: LinuxKeymapDocument,
  device: LinuxDeviceIdentifier,
): LinuxKeymapDocument {
  for (const value of [device.vendorId, device.productId]) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new Error(`vendor / product id は 0〜ffff（${value} が渡された）`);
    }
  }
  if (
    document.devices.some(
      (existing) =>
        existing.vendorId === device.vendorId && existing.productId === device.productId,
    )
  ) {
    return document;
  }
  return { ...document, devices: [...document.devices, device] };
}
