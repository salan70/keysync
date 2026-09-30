import { deviceNames } from "../core/mac-keymap/kanata/generate.ts";
import type { MacDeviceIdentifier } from "../core/mac-keymap/types.ts";

export function describeDevices(devices: readonly MacDeviceIdentifier[]): string {
  if (devices.length === 0) return "なし";
  return devices
    .map((device) => ("builtIn" in device ? "内蔵キーボード" : `外付け ${device.name}`))
    .join("、");
}

/**
 * kanata が掴むデバイスの指定（`macos-dev-names-include`）を文言化する。
 * 名前への写像は生成器の `deviceNames` を使い、ここで書き写さない（ADR 0025）。
 */
export function kanataDeviceText(devices: readonly MacDeviceIdentifier[]): string {
  const names = deviceNames(devices).map((name) => JSON.stringify(name));
  return `macos-dev-names-include (${names.join(" ")})`;
}
