/**
 * ローカルサーバーの Mac 適用 API が返す形。
 *
 * Web UI とサーバーの両方がこの型を参照する。**型だけを置き、Node の module を import
 * しない。** Web UI は HTTP 越しにしかサーバーへ触れない（ADR 0034）。
 */

import type { MacKeyboardLayout } from "../core/mac-keymap/types.ts";
import type { Diagnostic } from "../core/validation/types.ts";

/** API の path。 @doc docs/specs/local-server.md#createmacapi */
export const MAC_API = {
  status: "/api/mac/status",
  plan: "/api/mac/plan",
  apply: "/api/mac/apply",
} as const;

/** このマシンについてサーバーが知っていること。 */
export interface MacStatusResponse {
  readonly kind: "status";
  /** サーバーが読む workspace の絶対 path。 */
  readonly workspace: string;
  /** 内蔵キーボードの配列。検出できなければ `null`。 */
  readonly layout: MacKeyboardLayout | null;
}

/**
 * 差分 1 件。kanata の設定の行ではなく、盤面の言葉で表す。
 * layer の外の設定（閾値など）は `layer` が `null` で、`keyCode` に設定の名前を置く。
 */
export interface MacDiffEntryView {
  readonly layer: number | null;
  readonly keyCode: string;
  readonly change: "added" | "removed" | "changed";
}

/** 計画を組めた結果。`fingerprint` を送り返すと適用できる。 */
export interface MacPlanned {
  readonly kind: "planned";
  readonly workspace: string;
  /** 読んだ設定ファイルの絶対 path。 */
  readonly source: string;
  /** 書き込み先の kanata の設定ファイル。 */
  readonly config: string;
  readonly fingerprint: string;
  readonly entries: readonly MacDiffEntryView[];
  readonly diagnostics: readonly Diagnostic[];
  /** kanata が常駐していて、適用後に読み直させられるか。 */
  readonly running: boolean;
}

/** 計画の手前で止まった理由。どれも kanata の設定ファイルには触れていない。 */
export type MacPlanBlocked =
  | {
      readonly kind: "layout-mismatch";
      readonly machine: MacKeyboardLayout | null;
      readonly requested: MacKeyboardLayout;
    }
  | { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "digest-mismatch"; readonly path: string }
  | { readonly kind: "invalid"; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: "kanata-missing" }
  | { readonly kind: "check-failed"; readonly output: string };

export type MacPlanResponse = MacPlanned | MacPlanBlocked | MacApiFailure;

/** 適用の結果。`applied` 以降は設定ファイルが書き換わっている。 */
export type MacApplyResponse =
  | MacPlanBlocked
  | MacApiFailure
  /** 計画を組んだ後に中身が変わった。新しい計画を見せ直す。 */
  | { readonly kind: "fingerprint-mismatch"; readonly plan: MacPlanned }
  | {
      readonly kind: "applied";
      /** 適用前にファイルが無ければ `null`。 */
      readonly backup: string | null;
      /** kanata が常駐していなければ `false`。次に kanata が起動したときに読まれる。 */
      readonly reloaded: boolean;
    }
  | {
      readonly kind: "verify-failed";
      readonly backup: string | null;
      readonly entries: readonly MacDiffEntryView[];
    }
  /** 書き込みと verify は済み。kanata が読み直しに失敗した。巻き戻さない。 */
  | {
      readonly kind: "reload-failed";
      readonly backup: string | null;
      readonly output: string;
    };

/** 想定外の失敗と、リクエストの拒否。 */
export type MacApiFailure =
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "rejected"; readonly reason: string };

/** `plan` と `apply` が送る本文。 */
export interface MacPlanRequest {
  readonly layout: MacKeyboardLayout;
  /** Web UI が編集中の内容の `macKeymapDigest`。 */
  readonly digest: string;
}

export interface MacApplyRequest extends MacPlanRequest {
  readonly fingerprint: string;
}

/**
 * workspace のファイル API の path。Web UI は directory を選ばず、サーバーの workspace を
 * これで読み書きする（ADR 0038）。
 *
 * @doc docs/specs/local-server.md#createworkspaceapi
 */
export const WORKSPACE_API = {
  status: "/api/workspace/status",
  read: "/api/workspace/read",
  stat: "/api/workspace/stat",
  write: "/api/workspace/write",
  mkdir: "/api/workspace/mkdir",
} as const;

/** サーバーが開いている workspace。 */
export interface WorkspaceStatusResponse {
  readonly kind: "workspace";
  /** workspace の絶対 path。 */
  readonly root: string;
}

/** `read` の結果。ファイルが無ければ `base64` は `null`。 */
export interface WorkspaceReadResponse {
  readonly kind: "file";
  readonly base64: string | null;
}

/** `stat` の結果。ファイルが無ければ `stat` は `null`。 */
export interface WorkspaceStatResponse {
  readonly kind: "stat";
  readonly stat: { readonly modifiedAt: number; readonly contentHash?: string } | null;
}

/** `write` と `mkdir` の結果。 */
export interface WorkspaceDoneResponse {
  readonly kind: "done";
}

export type WorkspaceApiResponse =
  | WorkspaceStatusResponse
  | WorkspaceReadResponse
  | WorkspaceStatResponse
  | WorkspaceDoneResponse
  | MacApiFailure;
