/**
 * keyd と sudo を呼ぶ Node adapter。
 *
 * `/etc/keyd/` への書き込みと `keyd reload` には root が要る。KeySync はパスワードを
 * 扱わず、`sudo` を子プロセスとして起動して端末の認証へ任せる（ADR 0042）。
 * test は `KeydHost` の偽物を注入する。実物を通すと開発機の keyd が reload される。
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** KeySync が所有する keyd の設定ファイル。このファイル全体だけを書く（ADR 0042）。 */
export const KEYD_CONFIG_PATH = "/etc/keyd/keysync.conf";

/** keyd / sudo の実行結果。 */
export interface KeydResult {
  readonly ok: boolean;
  readonly output: string;
}

/**
 * keyd と sudo の境界。
 *
 * @doc docs/specs/linux-keymap.md#keydhost
 */
export interface KeydHost {
  /** `keyd check <path>`。keyd が入っていなければ `undefined`。 */
  check(path: string): Promise<KeydResult | undefined>;
  /** `sudo install -D -m 0644 <source> <target>`。 */
  install(source: string, target: string): Promise<KeydResult>;
  /** `sudo keyd reload`。 */
  reload(): Promise<KeydResult>;
}

/**
 * 実物の keyd と sudo を呼ぶ `KeydHost`。
 *
 * `keyd` は PATH から探す。Arch の package は `/usr/bin/keyd` に置く。
 *
 * @doc docs/specs/linux-keymap.md#keydhost
 */
export function createKeydHost(): KeydHost {
  return {
    async check(path) {
      try {
        const { stdout, stderr } = await execFileAsync("keyd", ["check", path]);
        return { ok: true, output: `${stdout}${stderr}`.trim() };
      } catch (error) {
        if (isMissing(error)) return undefined;
        return { ok: false, output: outputOf(error) };
      }
    },
    install: (source, target) =>
      interactive("sudo", ["install", "-D", "-m", "0644", source, target]),
    reload: () => interactive("sudo", ["keyd", "reload"]),
  };
}

/**
 * 端末を引き継いで実行する。sudo のパスワード入力は端末で行う。
 *
 * stdout は JSON の出力と混ざらないよう stderr へ回す。
 */
function interactive(command: string, args: readonly string[]): Promise<KeydResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", (error) => resolve({ ok: false, output: error.message }));
    child.on("close", (code) => resolve({ ok: code === 0, output: output.trim() }));
  });
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function outputOf(error: unknown): string {
  const record = error as { stdout?: string; stderr?: string; message?: string };
  return `${record.stdout ?? ""}${record.stderr ?? ""}`.trim() || (record.message ?? "");
}
