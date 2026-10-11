import { KEYMAP_VARIANT_NAME, type KeymapVariant } from "../workspace/keymap-variants.ts";
import type { SaveState } from "./save-state.ts";

/**
 * 保持と切り替えを止める理由。止めなければ `undefined`。
 *
 * 編集対象に限らず、workspace のどのファイルでも保存が済んでいない、または失敗していれば止める。
 * 切り替え後の読み直しは workspace 全体をディスクから読むので、画面にだけ残っている編集が
 * 別の対象にあっても消えてしまうためである。
 *
 * @doc docs/specs/ui.md#キーマップの保持
 */
export function variantBlockedReason(saves: readonly SaveState[]): string | undefined {
  if (saves.some((save) => save.kind === "saving")) {
    return "保存中のため、保存が終わってから行う。";
  }
  if (saves.some((save) => save.kind === "error" || save.kind === "conflict")) {
    return "保存に失敗しているファイルがあるため、保存を解決してから行う。";
  }
  return undefined;
}

/** 保持する名前の問題。使えるなら `undefined`。空は入力前として理由を出さない。 */
export function variantNameProblem(name: string): string | undefined {
  if (name === "") return undefined;
  if (KEYMAP_VARIANT_NAME.test(name)) return undefined;
  return "名前は小文字の英数字とハイフンだけ（先頭は英数字、64 文字まで）。";
}

/** 保持できるか。名前が空、規則外のとき、または適用対象が無いときは不可。 */
export function canSaveVariant(name: string, hasActiveFile: boolean): boolean {
  return hasActiveFile && name !== "" && KEYMAP_VARIANT_NAME.test(name);
}

/** 同名の保持があり、上書きの確認が要るか。 */
export function needsOverwrite(name: string, variants: readonly KeymapVariant[]): boolean {
  return variants.some((variant) => variant.name === name);
}
