import { useCallback, useEffect, useState } from "react";
import {
  deleteKeymapVariant,
  listKeymapVariants,
  matchKeymapVariant,
  saveKeymapVariant,
  switchKeymapVariant,
  type KeymapTarget,
  type KeymapVariant,
} from "../../workspace/keymap-variants.ts";
import type { WorkspaceFileStore } from "../../workspace/types.ts";
import { needsOverwrite } from "../keymap-variant-view.ts";
import { errorMessage } from "./use-status.ts";

export interface KeymapVariantsView {
  readonly variants: readonly KeymapVariant[];
  /** 適用対象と同じ内容の保持の名前。一致が無ければ `undefined`（未保持）。 */
  readonly matched: string | undefined;
  readonly busy: boolean;
  readonly save: (name: string) => Promise<void>;
  readonly switchTo: (name: string) => Promise<void>;
  readonly remove: (name: string) => Promise<void>;
}

/**
 * 保持したキーマップの一覧と操作。
 *
 * 一覧は、有効になったとき・編集対象を変えたとき・操作のあとに取り直す。編集のたびには取り直さない。
 * 切り替えのあとは `adopt` でディスクから読み直す。
 *
 * @doc docs/specs/ui.md#キーマップの保持
 */
export function useKeymapVariants({
  store,
  target,
  enabled,
  say,
  adopt,
}: {
  readonly store: WorkspaceFileStore | undefined;
  readonly target: KeymapTarget;
  readonly enabled: boolean;
  readonly say: (message: string) => void;
  readonly adopt: (message: string) => Promise<void>;
}): KeymapVariantsView {
  const [variants, setVariants] = useState<readonly KeymapVariant[]>([]);
  const [matched, setMatched] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const targetKey = target.kind === "cornix" ? "cornix" : `mac:${target.layout}`;

  const refresh = useCallback(async (): Promise<void> => {
    if (store === undefined) return;
    const next = await listKeymapVariants(store, target);
    setVariants(next);
    setMatched(await matchKeymapVariant(store, target, next));
  }, [store, targetKey]);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void refresh().catch((error: unknown) => {
      if (current) say(errorMessage(error));
    });
    return () => {
      current = false;
    };
  }, [enabled, refresh]);

  async function run(action: () => Promise<void>): Promise<void> {
    if (store === undefined || busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      say(errorMessage(error));
    } finally {
      try {
        await refresh();
      } catch (error) {
        say(errorMessage(error));
      }
      setBusy(false);
    }
  }

  return {
    variants,
    matched,
    busy,
    save: (name) =>
      run(async () => {
        if (store === undefined) return;
        const overwrite = needsOverwrite(name, variants);
        if (overwrite && !window.confirm(`${name} は既にある。現在の内容で上書きするか。`)) return;
        await saveKeymapVariant(store, target, name, { overwrite });
        say(`${name} として保持した`);
      }),
    switchTo: (name) =>
      run(async () => {
        if (store === undefined) return;
        await switchKeymapVariant(store, target, name);
        await adopt(`${name} に切り替えた。適用は実機 / kanata へ別途行う`);
      }),
    remove: (name) =>
      run(async () => {
        if (store === undefined) return;
        if (!window.confirm(`${name} を削除するか。`)) return;
        await deleteKeymapVariant(store, target, name);
        say(`${name} を削除した`);
      }),
  };
}
