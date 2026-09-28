/**
 * `linux-keyboard.<layout>.yaml` テキスト → desired state。
 *
 * `parseMacKeymapYaml` と同じく、serializer が出す部分集合だけを受け付ける。
 * 違いは `profile` が無いことと、`devices` が `vendor_id` / `product_id` の形だけなこと
 * （ADR 0042）。`tapping_term_ms` / `flow_tap_term_ms` の範囲と既定は Mac 側と同じ（ADR 0051）。
 */

import {
  LINUX_KEYMAP_SCHEMA,
  LinuxKeymapParseError,
  type LinuxDeviceIdentifier,
  type LinuxKeymapDocument,
} from "./types.ts";
import {
  DEFAULT_MAC_FLOW_TAP_TERM_MS,
  DEFAULT_MAC_TAPPING_TERM_MS,
  isMacFlowTapTerm,
  isMacTappingTerm,
  MAC_FLOW_TAP_TERM_RANGE,
  MAC_TAPPING_TERM_RANGE,
  type MacKeyboardLayout,
} from "../mac-keymap/types.ts";

const LAYER_PATTERN = /^ {2}([0-9]+):$/;
const ASSIGNMENT_PATTERN = /^ {4}("(?:\\.|[^"\\])*"):(?:\s+)(.*)$/;
const DEVICE_PATTERN = /^ {2}- \{ vendor_id: ([0-9]+), product_id: ([0-9]+) \}$/;

/** @doc docs/specs/linux-keymap.md#parselinuxkeymapyaml */
export function parseLinuxKeymapYaml(text: string): LinuxKeymapDocument {
  let schema: string | undefined;
  let layout: MacKeyboardLayout | undefined;
  let devices: LinuxDeviceIdentifier[] | undefined;
  let tappingTermMs: number | undefined;
  let flowTapTermMs: number | undefined;
  let sawLayers = false;
  let current: Map<string, string> | undefined;
  const layers = new Map<number, ReadonlyMap<string, string>>();

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trimEnd();
    const lineNumber = index + 1;
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    if (line.startsWith("schema:")) {
      schema = line.slice("schema:".length).trim();
      if (schema !== LINUX_KEYMAP_SCHEMA) {
        throw new LinuxKeymapParseError(`linux-keyboard.yaml の schema が未対応: ${schema}`);
      }
      continue;
    }
    if (line.startsWith("layout:")) {
      const value = line.slice("layout:".length).trim();
      if (value !== "ansi" && value !== "jis") {
        throw new LinuxKeymapParseError(`linux-keyboard.yaml の layout が未対応: ${value}`);
      }
      layout = value;
      continue;
    }
    if (line.startsWith("tapping_term_ms:")) {
      const value = line.slice("tapping_term_ms:".length).trim();
      const parsed = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
      if (!isMacTappingTerm(parsed)) {
        throw new LinuxKeymapParseError(
          `tapping_term_ms は ${MAC_TAPPING_TERM_RANGE.min}〜${MAC_TAPPING_TERM_RANGE.max} の整数: ${value}`,
        );
      }
      tappingTermMs = parsed;
      continue;
    }
    if (line.startsWith("flow_tap_term_ms:")) {
      const value = line.slice("flow_tap_term_ms:".length).trim();
      const parsed = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
      if (!isMacFlowTapTerm(parsed)) {
        throw new LinuxKeymapParseError(
          `flow_tap_term_ms は ${MAC_FLOW_TAP_TERM_RANGE.min}〜${MAC_FLOW_TAP_TERM_RANGE.max} の整数: ${value}`,
        );
      }
      flowTapTermMs = parsed;
      continue;
    }
    if (line === "devices:") {
      if (devices !== undefined) throw new LinuxKeymapParseError("devices が重複している");
      devices = [];
      continue;
    }
    if (line === "layers:") {
      sawLayers = true;
      continue;
    }

    if (!sawLayers && devices !== undefined) {
      const device = DEVICE_PATTERN.exec(line);
      if (device?.[1] !== undefined && device[2] !== undefined) {
        devices.push({ vendorId: Number(device[1]), productId: Number(device[2]) });
        continue;
      }
    }

    if (!sawLayers) {
      throw new LinuxKeymapParseError(`${lineNumber} 行目を解釈できない: ${rawLine}`);
    }

    const layer = LAYER_PATTERN.exec(line);
    if (layer?.[1] !== undefined) {
      const number = Number(layer[1]);
      if (layers.has(number)) throw new LinuxKeymapParseError(`layer ${number} が重複している`);
      current = new Map<string, string>();
      layers.set(number, current);
      continue;
    }

    const assignment = ASSIGNMENT_PATTERN.exec(line);
    if (assignment?.[1] === undefined || assignment[2] === undefined || current === undefined) {
      throw new LinuxKeymapParseError(`${lineNumber} 行目を解釈できない: ${rawLine}`);
    }
    const keyCode = unquote(assignment[1], lineNumber);
    if (keyCode.trim() === "") throw new LinuxKeymapParseError("key_code が空");
    if (current.has(keyCode)) {
      throw new LinuxKeymapParseError(
        `${lineNumber} 行目の ${keyCode} が同じ layer で重複している`,
      );
    }
    const keycode = unquote(assignment[2].trim(), lineNumber).trim();
    if (keycode === "") throw new LinuxKeymapParseError(`${keyCode} の keycode が空`);
    current.set(keyCode, keycode);
  }

  // Mac 側と違い既定値を持たない。配列も適用先も推測できないので明示させる（ADR 0042）。
  if (schema === undefined) throw new LinuxKeymapParseError("linux-keyboard.yaml に schema が無い");
  if (layout === undefined) throw new LinuxKeymapParseError("linux-keyboard.yaml に layout が無い");
  if (!sawLayers) throw new LinuxKeymapParseError("linux-keyboard.yaml に layers が無い");
  return {
    layout,
    devices: devices ?? [],
    tappingTermMs: tappingTermMs ?? DEFAULT_MAC_TAPPING_TERM_MS,
    flowTapTermMs: flowTapTermMs ?? DEFAULT_MAC_FLOW_TAP_TERM_MS,
    layers,
  };
}

function unquote(value: string, lineNumber: number): string {
  if (!value.startsWith('"')) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LinuxKeymapParseError(`${lineNumber} 行目の引用が壊れている: ${value}`);
  }
  if (typeof parsed !== "string") {
    throw new LinuxKeymapParseError(`${lineNumber} 行目の値が文字列ではない: ${value}`);
  }
  return parsed;
}
