/**
 * `mac-keyboard.yaml` テキスト → desired state。
 *
 * **汎用の YAML parser ではない**。`serializeMacKeymapYaml` が出す部分集合だけを受け付け、
 * それ以外は `MacKeymapParseError` で落とす。desired state を黙って読み違えるより、
 * 読めないことを大きな声で言うほうが安全なため（ADR 0009 と同じ理由）。
 *
 * 受け付ける形はインデントの深さで決まる。2 が layer 番号、4 が割り当て。
 * `devices` は serializer が出す flow mapping の 2 形だけを受ける（ADR 0026）。
 *
 */

import {
  DEFAULT_MAC_DEVICES,
  DEFAULT_MAC_LAYOUT,
  DEFAULT_MAC_FLOW_TAP_TERM_MS,
  DEFAULT_MAC_TAPPING_TERM_MS,
  isMacFlowTapTerm,
  isMacTappingTerm,
  MAC_FLOW_TAP_TERM_RANGE,
  MAC_TAPPING_TERM_RANGE,
  LEGACY_MAC_KEYMAP_SCHEMA,
  MAC_KEYMAP_SCHEMA,
  MacKeymapParseError,
  type MacDeviceIdentifier,
  type MacKeyboardLayout,
  type MacKeymapDocument,
} from "./types.ts";

const LAYER_PATTERN = /^ {2}([0-9]+):$/;
const ASSIGNMENT_PATTERN = /^ {4}("(?:\\.|[^"\\])*"):(?:\s+)(.*)$/;
const BUILT_IN_DEVICE_PATTERN = /^ {2}- \{ built_in: true \}$/;
const EXTERNAL_DEVICE_PATTERN = /^ {2}- \{ vendor_id: ([0-9]+), product_id: ([0-9]+) \}$/;

/** @doc docs/specs/mac-keymap.md#parsemackeymapyaml */
export function parseMacKeymapYaml(text: string): MacKeymapDocument {
  let layout: MacKeyboardLayout | undefined;
  let profile: string | undefined;
  let devices: MacDeviceIdentifier[] | undefined;
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
      const schema = line.slice("schema:".length).trim();
      if (schema !== MAC_KEYMAP_SCHEMA && schema !== LEGACY_MAC_KEYMAP_SCHEMA) {
        throw new MacKeymapParseError(`mac-keyboard.yaml の schema が未対応: ${schema}`);
      }
      continue;
    }
    if (line.startsWith("layout:")) {
      const value = line.slice("layout:".length).trim();
      if (value !== "ansi" && value !== "jis") {
        throw new MacKeymapParseError(`mac-keyboard.yaml の layout が未対応: ${value}`);
      }
      layout = value;
      continue;
    }
    if (line.startsWith("tapping_term_ms:")) {
      const value = line.slice("tapping_term_ms:".length).trim();
      const parsed = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
      if (!isMacTappingTerm(parsed)) {
        throw new MacKeymapParseError(
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
        throw new MacKeymapParseError(
          `flow_tap_term_ms は ${MAC_FLOW_TAP_TERM_RANGE.min}〜${MAC_FLOW_TAP_TERM_RANGE.max} の整数: ${value}`,
        );
      }
      flowTapTermMs = parsed;
      continue;
    }
    if (line.startsWith("profile:")) {
      profile = unquote(line.slice("profile:".length).trim(), lineNumber).trim();
      if (profile === "") throw new MacKeymapParseError("profile 名が空");
      continue;
    }
    if (line === "devices:") {
      if (devices !== undefined) throw new MacKeymapParseError("devices が重複している");
      devices = [];
      continue;
    }
    if (line === "layers:") {
      sawLayers = true;
      continue;
    }

    // devices の項目は layers より前にしか現れない。layers 開始後は割り当てとして読む。
    if (!sawLayers && devices !== undefined) {
      if (BUILT_IN_DEVICE_PATTERN.test(line)) {
        devices.push({ builtIn: true });
        continue;
      }
      const external = EXTERNAL_DEVICE_PATTERN.exec(line);
      if (external?.[1] !== undefined && external[2] !== undefined) {
        devices.push({ vendorId: Number(external[1]), productId: Number(external[2]) });
        continue;
      }
    }

    if (!sawLayers) throw new MacKeymapParseError(`${lineNumber} 行目を解釈できない: ${rawLine}`);

    const layer = LAYER_PATTERN.exec(line);
    if (layer?.[1] !== undefined) {
      const number = Number(layer[1]);
      if (layers.has(number)) throw new MacKeymapParseError(`layer ${number} が重複している`);
      current = new Map<string, string>();
      layers.set(number, current);
      continue;
    }

    const assignment = ASSIGNMENT_PATTERN.exec(line);
    if (assignment?.[1] === undefined || assignment[2] === undefined || current === undefined) {
      throw new MacKeymapParseError(`${lineNumber} 行目を解釈できない: ${rawLine}`);
    }
    const keyCode = unquote(assignment[1], lineNumber);
    if (keyCode.trim() === "") throw new MacKeymapParseError("key_code が空");
    if (current.has(keyCode)) {
      throw new MacKeymapParseError(`${lineNumber} 行目の ${keyCode} が同じ layer で重複している`);
    }
    const keycode = unquote(assignment[2].trim(), lineNumber).trim();
    if (keycode === "") throw new MacKeymapParseError(`${keyCode} の keycode が空`);
    current.set(keyCode, keycode);
  }

  if (profile === undefined) throw new MacKeymapParseError("mac-keyboard.yaml に profile が無い");
  if (!sawLayers) throw new MacKeymapParseError("mac-keyboard.yaml に layers が無い");
  return {
    layout: layout ?? DEFAULT_MAC_LAYOUT,
    devices: devices ?? DEFAULT_MAC_DEVICES,
    tappingTermMs: tappingTermMs ?? DEFAULT_MAC_TAPPING_TERM_MS,
    flowTapTermMs: flowTapTermMs ?? DEFAULT_MAC_FLOW_TAP_TERM_MS,
    profile,
    layers,
  };
}

function unquote(value: string, lineNumber: number): string {
  if (!value.startsWith('"')) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new MacKeymapParseError(`${lineNumber} 行目の引用が壊れている: ${value}`);
  }
  if (typeof parsed !== "string") {
    throw new MacKeymapParseError(`${lineNumber} 行目の値が文字列ではない: ${value}`);
  }
  return parsed;
}
