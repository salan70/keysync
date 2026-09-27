import { useEffect, useRef, useState } from "react";
import type { MacKeyboardLayout, MacKeymapDocument } from "../../core/mac-keymap/types.ts";
import type {
  MacApiFailure,
  MacApplyResponse,
  MacPlanBlocked,
  MacPlanned,
} from "../../server/protocol.ts";
import { macKeymapDigest } from "../../workspace/mac-keymap-file.ts";
import type { MacMachine } from "../mac-apply-gate.ts";
import {
  applyMacRemote,
  fetchMacStatus,
  planMacApplyRemote,
  type MacServerUnreachable,
} from "../mac-server.ts";

/** 計画を組めずに止まった理由。 */
export type MacApplyStopped = MacPlanBlocked | MacApiFailure | MacServerUnreachable;

/**
 * kanata で効いていると確かめた mod-tap の閾値。適用して kanata が読み直したとき、または
 * 差分が無く kanata が常駐していると分かったときにだけ記録する。打鍵テストが、どの閾値で
 * 打った結果かを示すのに使う（ADR 0045・0049）。
 *
 * @doc docs/specs/ui.md#typing-panel
 */
export interface MacEffectiveTappingTerm {
  readonly layout: MacKeyboardLayout;
  readonly tappingTermMs: number;
}

/** 書き込みを試みた後の結果。`fingerprint-mismatch` は計画の見直しへ戻すので含めない。 */
export type MacApplyOutcome =
  | Exclude<MacApplyResponse, { kind: "fingerprint-mismatch" } | MacPlanBlocked | MacApiFailure>
  | MacApplyStopped;

/** 適用ダイアログの段階。 */
export type MacApplyView =
  | { readonly phase: "closed" }
  | { readonly phase: "planning" }
  | { readonly phase: "stopped"; readonly reason: MacApplyStopped }
  | { readonly phase: "review"; readonly plan: MacPlanned; readonly changed: boolean }
  | { readonly phase: "applying"; readonly plan: MacPlanned }
  | { readonly phase: "result"; readonly outcome: MacApplyOutcome };

/**
 * `kanata へ適用…` の状態。ローカルサーバーへの問い合わせだけを持ち、ファイルには触れない。
 *
 * このマシンの配列は起動時に 1 回だけ訊く。内蔵配列は起動中に変わらない。
 *
 * @doc docs/specs/ui.md#mac-apply
 */
export function useMacApply() {
  const [machine, setMachine] = useState<MacMachine>({ kind: "unknown" });
  const [view, setView] = useState<MacApplyView>({ phase: "closed" });
  const [effective, setEffective] = useState<MacEffectiveTappingTerm | undefined>();
  const target = useRef<
    | {
        readonly layout: MacKeyboardLayout;
        readonly digest: string;
        readonly tappingTermMs: number;
      }
    | undefined
  >(undefined);

  function markEffective(): void {
    if (target.current === undefined) return;
    const { layout, tappingTermMs } = target.current;
    setEffective({ layout, tappingTermMs });
  }

  useEffect(() => {
    let alive = true;
    void fetchMacStatus().then((status) => {
      if (!alive) return;
      setMachine(
        status.kind === "status"
          ? { kind: "known", layout: status.layout }
          : { kind: "unreachable" },
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 計画を組んで差分を見せる。 */
  async function open(layout: MacKeyboardLayout, document: MacKeymapDocument): Promise<void> {
    setView({ phase: "planning" });
    const digest = await macKeymapDigest(document, globalThis.crypto);
    target.current = { layout, digest, tappingTermMs: document.tappingTermMs };
    const result = await planMacApplyRemote({ layout, digest });
    if (result.kind === "planned" && result.entries.length === 0 && result.running) {
      markEffective();
    }
    setView(
      result.kind === "planned"
        ? { phase: "review", plan: result, changed: false }
        : { phase: "stopped", reason: result },
    );
  }

  /** 見せた計画の fingerprint を送り返して適用する。 */
  async function apply(): Promise<void> {
    if (view.phase !== "review" || target.current === undefined) return;
    const { plan } = view;
    setView({ phase: "applying", plan });
    const { layout, digest } = target.current;
    const result = await applyMacRemote({ layout, digest, fingerprint: plan.fingerprint });
    if (result.kind === "fingerprint-mismatch") {
      setView({ phase: "review", plan: result.plan, changed: true });
      return;
    }
    if (result.kind === "applied" && result.reloaded) markEffective();
    setView({ phase: "result", outcome: result });
  }

  function close(): void {
    target.current = undefined;
    setView({ phase: "closed" });
  }

  return { machine, view, effective, open, apply, close };
}
