/**
 * 打鍵ログの型（ADR 0046）。
 *
 * 記録の層は 3 つある。どれも Karabiner が処理した**後**の入力で、Karabiner に入る前の
 * 物理的な押下は記録できない（R-009）。
 *
 * - `hid`: Karabiner の仮想キーボードが出した HID の押下と離し
 * - `os`: CGEventTap が受けた OS のキーイベント。ブラウザに届かないキー（⌘Space など）も含む
 * - `browser`: Web UI の打鍵テストの入力欄が受けた `keydown` / `keyup`
 *
 * `hid` と `os` の時刻は同じ時計で、同じ打鍵は同じ値になる。記録には `meta.originNs`（起動からの
 * ns）を引いた相対値を書く。起動からの ns は稼働 104 日を超えると JavaScript の数値で
 * 正確に表せないためである。
 * `browser` の時刻はページの `performance.now()` 基準の ms で、他の 2 つとは揃わない。
 */

import type { MacKeyboardLayout } from "../mac-keymap/types.ts";

/**
 * Karabiner の仮想キーボードが出した HID の値の変化。
 *
 * @doc docs/specs/typing-log.md#keylogevent
 */
export interface HidLogEvent {
  readonly type: "hid";
  /** 記録開始（`meta.originNs`）からの ns。 */
  readonly ns: number;
  /** Keyboard/Keypad page（0x07）の usage。 */
  readonly usage: number;
  readonly down: boolean;
  /** 値を出したデバイスの product 名。 */
  readonly device: string;
}

/**
 * CGEventTap が受けたキーイベント。
 *
 * @doc docs/specs/typing-log.md#keylogevent
 */
export interface OsLogEvent {
  readonly type: "os";
  /** 記録開始（`meta.originNs`）からの ns。 */
  readonly ns: number;
  /** `flags` は修飾キーの変化（flagsChanged）。 */
  readonly kind: "down" | "up" | "flags";
  /** macOS の仮想キーコード。 */
  readonly keycode: number;
  /** `CGEventFlags` の生の値。左右の修飾キーを区別するビットを含む。 */
  readonly flags: number;
  /** OS が解釈した文字。 */
  readonly chars: string;
  readonly repeat: boolean;
}

/**
 * Web UI の入力欄が受けたキーイベント。
 *
 * @doc docs/specs/typing-log.md#keylogevent
 */
export interface BrowserLogEvent {
  readonly type: "browser";
  /** `KeyboardEvent.timeStamp`（ms、小数を含む）。 */
  readonly ms: number;
  readonly kind: "keydown" | "keyup";
  readonly key: string;
  readonly code: string;
  /** `KeyboardEvent.location`。1 が左、2 が右の修飾キー。 */
  readonly location: number;
  readonly repeat: boolean;
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly composing: boolean;
}

/** @doc docs/specs/typing-log.md#keylogevent */
export type KeyLogEvent = HidLogEvent | OsLogEvent | BrowserLogEvent;

/**
 * ログ 1 本の先頭に置く情報。
 *
 * `tappingTermMs` は記録した時点で Karabiner に効いていた閾値で、確かめられなければ `null`。
 * `trial` は Web UI の打鍵テストが書くときだけ持つ。
 *
 * @doc docs/specs/typing-log.md#keylogmeta
 */
export interface KeyLogMeta {
  readonly type: "meta";
  readonly recorder: "cli" | "browser";
  /** 記録を始めた時刻（ISO 8601）。 */
  readonly startedAt: string;
  readonly layout: MacKeyboardLayout;
  readonly tappingTermMs: number | null;
  /** `hid` / `os` の時刻の原点（起動からの ns を 10 進の文字列で）。CLI だけが書く。 */
  readonly originNs?: string;
  /** CLI の課題つき記録の課題ごとの結果。区間は Return で区切った順に並ぶ。 */
  readonly trials?: readonly {
    readonly taskId: string;
    readonly prompt: string;
    /** ターミナルが受け取った行。IME を通った後の文字列で、採点には使わない。 */
    readonly typed: string;
    readonly summary: unknown;
  }[];
  readonly trial?: {
    readonly taskId: string;
    /** 文章課題の本文。hold 課題では押し続ける位置と相手の文字。 */
    readonly prompt: string;
    readonly summary: unknown;
  };
}
