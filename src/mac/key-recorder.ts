/**
 * 打鍵レコーダー（`key-recorder/KeyRecorder.swift`）の Node adapter（ADR 0046）。
 *
 * Swift の source を初回にビルドし、`~/Library/Caches/keysync/` に source の hash 付きで置く。
 * source が変われば別の名前になり、古い binary を使い続けない。
 *
 * ビルドは Xcode の `swiftc` で行う。nix の devShell は `SDKROOT` などを apple-sdk 11.3 に
 * 固定しており、Xcode の Swift 6 はその SDK を読めない（R-009）。そのため 3 つの変数を外して
 * `/usr/bin/xcrun` に SDK を選ばせる。
 */

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { HidLogEvent, OsLogEvent } from "../core/typing-log/types.ts";

const execFileAsync = promisify(execFile);

const SOURCE = join(import.meta.dirname, "key-recorder", "KeyRecorder.swift");
const CACHE = join(homedir(), "Library", "Caches", "keysync");
const XCRUN = "/usr/bin/xcrun";

/**
 * 1 回の記録。
 *
 * @doc docs/specs/typing-log.md#keyrecorder
 */
export interface KeyRecording {
  /** `hid` / `os` の時刻の原点（起動からの ns）。 */
  readonly originNs: string | undefined;
  /** 開けて値を読んだキーボード。 */
  readonly hidOpened: readonly string[];
  /** Karabiner などが seize していて開けなかったキーボード。 */
  readonly hidBlocked: readonly string[];
  readonly hidNotPermitted: boolean;
  readonly tapOk: boolean;
  readonly warnings: readonly string[];
  readonly events: readonly (HidLogEvent | OsLogEvent)[];
}

/**
 * 記録の口。テストでは偽物を注入する。
 *
 * @doc docs/specs/typing-log.md#keyrecorder
 */
export interface KeyRecorder {
  /** `seconds` 秒、または SIGINT まで記録する。`onStart` は記録が始まったときに呼ぶ。 */
  record(seconds: number, onStart: () => void): Promise<KeyRecording>;
}

/** Xcode の SDK を使わせるため、nix の devShell が固定した変数を外した環境。 */
function buildEnvironment(): NodeJS.ProcessEnv {
  const {
    SDKROOT: _sdk,
    DEVELOPER_DIR: _developer,
    MACOSX_DEPLOYMENT_TARGET: _target,
    ...rest
  } = process.env;
  return rest;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** source の hash を名前にした binary を返す。無ければビルドする。 */
async function ensureBinary(): Promise<string> {
  const source = await readFile(SOURCE);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const binary = join(CACHE, `key-recorder-${hash}`);
  if (await exists(binary)) return binary;
  await mkdir(CACHE, { recursive: true });
  const building = `${binary}.building-${process.pid}`;
  try {
    await execFileAsync(XCRUN, ["--sdk", "macosx", "swiftc", "-O", SOURCE, "-o", building], {
      env: buildEnvironment(),
    });
  } catch (error) {
    const output = (error as { stderr?: string }).stderr ?? String(error);
    throw new Error(`打鍵レコーダーをビルドできない（Xcode の swiftc が要る）:\n${output.trim()}`);
  }
  await rename(building, binary);
  return binary;
}

type RecorderLine =
  | {
      readonly type: "start";
      readonly originNs: string;
      readonly hidNotPermitted: boolean;
      readonly tapOk: boolean;
    }
  | { readonly type: "device"; readonly product: string; readonly opened: boolean }
  | { readonly type: "warning"; readonly message: string }
  | { readonly type: "end" }
  | HidLogEvent
  | OsLogEvent;

/**
 * 実物の Swift レコーダーを起動する実装。
 *
 * 記録中の SIGINT（Ctrl-C）は子プロセスにも届き、子は記録を閉じて終わる。親は SIGINT で
 * 落ちず、子の終了を待ってからログを書く。
 *
 * @doc docs/specs/typing-log.md#keyrecorder
 */
export function createKeyRecorder(): KeyRecorder {
  return {
    async record(seconds, onStart) {
      const binary = await ensureBinary();
      const child = spawn(binary, [String(seconds)], { stdio: ["ignore", "pipe", "inherit"] });
      const keepAlive = () => {};
      process.on("SIGINT", keepAlive);
      let originNs: string | undefined;
      let hidNotPermitted = false;
      let tapOk = false;
      const hidOpened: string[] = [];
      const hidBlocked: string[] = [];
      const warnings: string[] = [];
      const events: (HidLogEvent | OsLogEvent)[] = [];
      try {
        for await (const text of createInterface({ input: child.stdout })) {
          if (text.trim() === "") continue;
          const line = JSON.parse(text) as RecorderLine;
          if (line.type === "start") {
            originNs = line.originNs;
            hidNotPermitted = line.hidNotPermitted;
            tapOk = line.tapOk;
            onStart();
          } else if (line.type === "device") {
            (line.opened ? hidOpened : hidBlocked).push(line.product);
          } else if (line.type === "warning") {
            warnings.push(line.message);
          } else if (line.type === "hid" || line.type === "os") {
            events.push(line);
          }
        }
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null) resolve();
          else child.once("close", () => resolve());
        });
      } finally {
        process.off("SIGINT", keepAlive);
      }
      return { originNs, hidOpened, hidBlocked, hidNotPermitted, tapOk, warnings, events };
    },
  };
}
