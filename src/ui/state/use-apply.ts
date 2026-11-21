import { useRef, useState } from "react";
import {
  abortApply,
  confirmApply,
  createApplyPlan,
  createValidatedApplyInput,
  recordVerifyResult,
  type ApplyState,
} from "../../core/apply/plan.ts";
import { serializeVil } from "../../core/vil/serialize.ts";
import { evaluateApplyGate, type ApplyGateWithEvidence } from "../../core/validation/gate.ts";
import { DeviceIoError, type RoundTripProgress } from "../../device/protocol.ts";
import type { ReadDeviceResult, WebHidConnection } from "../../device/webhid.ts";
import { backupPath, WORKSPACE_LAYOUT } from "../../workspace/layout.ts";
import type { WorkspaceFileStore } from "../../workspace/types.ts";
import type { ApplyStep } from "../apply-dialog-view.ts";
import { errorMessage } from "./use-status.ts";

export interface ApplyOptions {
  readonly say: (message: string) => void;
  readonly setProgress: (progress: RoundTripProgress | undefined) => void;
}

/**
 * Apply の状態機械。backup → 差分確認 → 確認 → 書き込みと verify → 結果の順にだけ進む。
 *
 * 書き込みを始める前はキャンセルでき、始めた後は「中断」だけを受け付ける。
 * 中断した状態は持ち越さず、full read からやり直させる（ADR 0005 / 0008）。
 * 書き込む plan は確認時の fingerprint と一致するときだけ作り直して使う。
 *
 * @doc docs/specs/ui.md#状態の持ち方
 */
export function useApply({ say, setProgress }: ApplyOptions) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ApplyStep>("backup");
  const [backupError, setBackupError] = useState<string | undefined>();
  const [state, setState] = useState<ApplyState | undefined>();
  const [roundTrips, setRoundTrips] = useState(0);
  const cancellation = useRef(false);

  function confirmation(
    gate: ApplyGateWithEvidence,
    snapshot: ReadDeviceResult["snapshot"],
  ): ApplyState | undefined {
    if (!gate.allowed) return undefined;
    return {
      phase: "awaitingConfirmation",
      plan: createApplyPlan(createValidatedApplyInput(gate, snapshot)),
    };
  }

  /** modal を開き、読込済みの実機状態を backup として保存してから差分確認へ進む。 */
  async function begin(input: {
    readonly store: WorkspaceFileStore;
    readonly deviceRead: ReadDeviceResult;
    readonly gate: ApplyGateWithEvidence;
  }): Promise<void> {
    cancellation.current = false;
    setRoundTrips(0);
    setState(undefined);
    setBackupError(undefined);
    setStep("backup");
    setOpen(true);
    try {
      const backupText = serializeVil(input.deviceRead.document);
      await input.store.writeText(backupPath(), backupText);
      await input.store.writeText(WORKSPACE_LAYOUT.latestBackup, backupText);
    } catch (error) {
      setBackupError(errorMessage(error));
      say(errorMessage(error));
      return;
    }
    setStep("diff");
    try {
      setState(confirmation(input.gate, input.deviceRead.snapshot));
    } catch (error) {
      setState(undefined);
      say(errorMessage(error));
    }
  }

  function next(): void {
    if (step === "diff") setStep("confirm");
  }

  /** 確認段階の acknowledge。保存できたら gate を評価し直し、書き込める状態かを決め直す。 */
  async function acknowledge(input: {
    readonly ids: readonly string[];
    readonly persist: (ids: readonly string[]) => Promise<boolean>;
    readonly gate: ApplyGateWithEvidence | undefined;
    readonly deviceRead: ReadDeviceResult | undefined;
  }): Promise<void> {
    if (!(await input.persist(input.ids))) return;
    if (input.gate === undefined || input.deviceRead === undefined) {
      setState(undefined);
      return;
    }
    const nextGate = evaluateApplyGate(input.gate.evidence, [...new Set(input.ids)].sort());
    if (!nextGate.allowed) {
      setState(undefined);
      return;
    }
    try {
      setState(confirmation(nextGate, input.deviceRead.snapshot));
    } catch (error) {
      setState(undefined);
      say(errorMessage(error));
    }
  }

  /** 差分を 1 件ずつ書き、同じ entry を読み直して確かめる。終えたら実機を full read し直す。 */
  async function write(input: {
    readonly connection: WebHidConnection;
    readonly deviceRead: ReadDeviceResult;
    readonly gate: ApplyGateWithEvidence | undefined;
    readonly reread: () => Promise<void>;
  }): Promise<void> {
    if (state?.phase !== "awaitingConfirmation" || input.gate === undefined) return;
    try {
      cancellation.current = false;
      setRoundTrips(0);
      const plan = createApplyPlan(
        createValidatedApplyInput(input.gate, input.deviceRead.snapshot),
      );
      let current = confirmApply(plan, state.plan.fingerprint);
      setState(current);
      let completedRoundTrips = 0;
      for (const operation of plan.operations) {
        if (current.phase !== "writing") break;
        try {
          let operationRoundTrips = 0;
          const observed = await input.connection.writeAndVerify(
            operation.target,
            operation.after,
            (event) => {
              operationRoundTrips = event.count;
              setRoundTrips(completedRoundTrips + event.count);
              setProgress(event);
            },
          );
          current = recordVerifyResult(current, observed);
          completedRoundTrips += operationRoundTrips;
        } catch (error) {
          if (!(error instanceof DeviceIoError)) throw error;
          current = abortApply(
            current,
            error.reason === "timeout"
              ? "timeout"
              : error.reason === "disconnected"
                ? "disconnected"
                : "protocol-error",
          );
        }
        if (cancellation.current && current.phase === "writing")
          current = abortApply(current, "user-cancelled");
        setState(current);
        if (current.phase === "aborted") break;
      }
      if (current.phase !== "completed") {
        say("Applyを中断した。再接続後にfull readからやり直してください");
        return;
      }
      try {
        await input.reread();
        say("実機に反映した（電源断後の永続化は未確認）");
      } catch (error) {
        say(
          `実機に反映したが、反映後のfull readに失敗した: ${errorMessage(error)}。再接続してfull readからやり直してください`,
        );
      }
    } catch (error) {
      say(errorMessage(error));
    } finally {
      setProgress(undefined);
    }
  }

  /** 書き込み中は中断、それ以外は modal を閉じる。 */
  function cancel(): void {
    cancellation.current = true;
    if (state?.phase === "writing") {
      setState((current) =>
        current?.phase === "writing" ? abortApply(current, "user-cancelled") : current,
      );
      say("Applyを中断した。進行中のI/Oの完了を待っています");
      return;
    }
    setOpen(false);
  }

  /** 実機の状態が古くなったら、Apply の途中状態を捨てる。 */
  function reset(): void {
    setOpen(false);
    setState(undefined);
    setRoundTrips(0);
    setBackupError(undefined);
  }

  return {
    open,
    step,
    backupError,
    state,
    roundTrips,
    begin,
    next,
    acknowledge,
    write,
    cancel,
    reset,
  };
}
