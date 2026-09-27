/**
 * kanata を呼ぶ Node adapter。
 *
 * kanata は root の launchd daemon として常駐し、KeySync が所有する設定ファイル 1 本を読む
 * （ADR 0049）。設定ファイルは利用者の所有で、反映は kanata の TCP server へ Reload を送って
 * 行う。したがって適用に root は要らない。root が要るのは常駐の登録（`service.ts`）だけである。
 *
 * test は `KanataHost` の偽物を注入する。実物を通すと開発機の kanata が reload される。
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** kanata の TCP server の待ち受け先。localhost だけで待ち受ける。 */
export const KANATA_HOST = "127.0.0.1";
export const KANATA_PORT = 5179;

/**
 * kanata の実行ファイルを探す順。PATH の次に Homebrew の既定の場所を見る。
 * `just ui` は nix の devShell から起動するため、PATH に Homebrew が無いことがある。
 */
const KANATA_CANDIDATES = ["kanata", "/opt/homebrew/bin/kanata", "/usr/local/bin/kanata"];

/** KeySync が所有する kanata の設定ファイルの既定の場所。このファイル全体だけを書く。 */
export function defaultKanataConfigPath(): string {
  return join(homedir(), "Library", "Application Support", "keysync", "kanata.kbd");
}

/** kanata の実行結果。 */
export interface KanataResult {
  readonly ok: boolean;
  readonly output: string;
}

/** Reload の結果。常駐していなければ `not-running`。 */
export type KanataReload =
  | { readonly kind: "reloaded" }
  | { readonly kind: "not-running" }
  | { readonly kind: "failed"; readonly output: string };

/**
 * kanata の境界。
 *
 * @doc docs/specs/mac-keymap.md#kanatahost
 */
export interface KanataHost {
  /** `kanata --cfg <path> --check`。kanata が入っていなければ `undefined`。 */
  check(path: string): Promise<KanataResult | undefined>;
  /** 常駐している kanata に設定を読み直させる。 */
  reload(): Promise<KanataReload>;
  /** 常駐している kanata の TCP server に接続できるか。 */
  reachable(): Promise<boolean>;
  /** kanata の実行ファイルの path。見つからなければ `undefined`。 */
  binary(): Promise<string | undefined>;
}

/**
 * 実物の kanata を呼ぶ `KanataHost`。
 *
 * @doc docs/specs/mac-keymap.md#kanatahost
 */
export function createKanataHost(
  port: number = KANATA_PORT,
  candidates: readonly string[] = KANATA_CANDIDATES,
): KanataHost {
  const binary = async () => {
    for (const candidate of candidates) {
      try {
        await execFileAsync(candidate, ["--version"]);
        return candidate;
      } catch {
        // 次の候補を試す。
      }
    }
    return undefined;
  };
  return {
    binary,
    async check(path) {
      const kanata = await binary();
      if (kanata === undefined) return undefined;
      try {
        const { stdout, stderr } = await execFileAsync(kanata, ["--cfg", path, "--check"]);
        return { ok: true, output: `${stdout}${stderr}`.trim() };
      } catch (error) {
        return { ok: false, output: outputOf(error) };
      }
    },
    reload: () => reloadOverTcp(port),
    reachable: () => reachable(port),
  };
}

/**
 * TCP で `{"Reload":{"wait":true}}` を送り、`ReloadResult` を待つ。
 *
 * kanata は 1 行 1 JSON で応答する。Reload の結果の前に layer の変化などの通知が混ざることが
 * あるので、`ReloadResult` が来るまで読み進める。
 */
function reloadOverTcp(port: number, timeoutMs = 6000): Promise<KanataReload> {
  return new Promise((resolve) => {
    const socket = connect({ host: KANATA_HOST, port });
    let buffer = "";
    let settled = false;
    const finish = (result: KanataReload) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () =>
      finish({ kind: "failed", output: `kanata が ${timeoutMs} ms 以内に応答しない` }),
    );
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ Reload: { wait: true, timeout_ms: timeoutMs - 1000 } })}\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        const result = parseReloadResult(line);
        if (result !== undefined) finish(result);
      }
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        error.code === "ECONNREFUSED"
          ? { kind: "not-running" }
          : { kind: "failed", output: error.message },
      );
    });
    socket.on("close", () => finish({ kind: "failed", output: "kanata が応答せずに切断した" }));
  });
}

/** 1 行が `ReloadResult` なら結果にする。別の通知なら `undefined`。 */
export function parseReloadResult(line: string): KanataReload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const result = record.ReloadResult;
  if (typeof result === "object" && result !== null) {
    return (result as { ok?: unknown }).ok === true
      ? { kind: "reloaded" }
      : { kind: "failed", output: line };
  }
  const error = record.Error;
  if (typeof error === "object" && error !== null) return { kind: "failed", output: line };
  return undefined;
}

function reachable(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: KANATA_HOST, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

/**
 * temp へ書いてから rename で置き換える。親ディレクトリが無ければ作る。
 *
 * kanata が reload の途中まで書けたファイルを読まないようにする。rename は同じ filesystem で
 * なければ atomic にならないので、temp は**置き換え先と同じディレクトリ**に作る。
 */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const directory = await mkdtemp(join(dirname(path), ".keysync-"));
  const temporary = join(directory, basename(path));
  try {
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function outputOf(error: unknown): string {
  const record = error as { stdout?: string; stderr?: string; message?: string };
  return `${record.stdout ?? ""}${record.stderr ?? ""}`.trim() || (record.message ?? "");
}
