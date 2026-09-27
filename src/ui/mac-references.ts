import { BUILT_IN_KEYBOARD_NAME } from "../core/mac-keymap/kanata/generate.ts";
import type { MacDeviceIdentifier } from "../core/mac-keymap/types.ts";

export function describeDevices(devices: readonly MacDeviceIdentifier[]): string {
  if (devices.length === 0) return "なし";
  return devices
    .map((device) =>
      "builtIn" in device ? "内蔵キーボード" : `外付け ${device.vendorId}:${device.productId}`,
    )
    .join("、");
}

/**
 * kanata が掴むデバイスの指定（`macos-dev-names-include`）を文言化する。
 * kanata は外付けを id で指せないので、外付けは「指せない」と出す（ADR 0049）。
 */
export function kanataDeviceText(devices: readonly MacDeviceIdentifier[]): string {
  const names = devices.map((device) =>
    "builtIn" in device
      ? JSON.stringify(BUILT_IN_KEYBOARD_NAME)
      : `外付け ${device.vendorId}:${device.productId}（kanata で指せない）`,
  );
  return `macos-dev-names-include (${names.join(" ")})`;
}
