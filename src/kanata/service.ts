/**
 * kanata を root の launchd daemon として登録する Node adapter。
 *
 * kanata は内蔵キーボードを掴み、Karabiner の VirtualHIDDevice daemon へ出力するため root で
 * 動かす（R-010）。登録には root が要る。KeySync はパスワードを扱わず、`sudo` を子プロセスと
 * して起動して端末の認証へ任せる（ADR 0042 と同じ、ADR 0049）。登録は 1 回だけで、以後の
 * 適用は TCP の Reload で行うので root は要らない。
 *
 * test は `ServiceHost` の偽物を注入する。実物を通すと開発機の launchd が書き換わる。
 */

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { KANATA_HOST, KANATA_PORT } from "./node.ts";

/** launchd の label。plist のファイル名にも使う。 */
export const KANATA_SERVICE_LABEL = "dev.keysync.kanata";

/** 登録する plist の置き場所。 */
export const KANATA_SERVICE_PLIST = `/Library/LaunchDaemons/${KANATA_SERVICE_LABEL}.plist`;

/** kanata の標準出力と標準エラーの置き場所。 */
export const KANATA_SERVICE_LOG = "/var/log/keysync-kanata.log";

/** plist の中身を決める値。 */
export interface KanataServiceOptions {
  /** kanata の実行ファイルの絶対 path。 */
  readonly kanata: string;
  /** kanata が読む設定ファイルの絶対 path。 */
  readonly config: string;
  readonly port?: number;
  readonly log?: string;
}

/**
 * kanata を常駐させる launchd の plist。
 *
 * `RunAtLoad` で起動時に動かし、`KeepAlive` で落ちたら起動し直す。`--no-wait` は、エラーで
 * 止まるときに Enter の入力を待たないようにする（launchd には端末が無い）。
 *
 * @doc docs/specs/mac-keymap.md#kanataserviceplist
 */
export function kanataServicePlist(options: KanataServiceOptions): string {
  const port = options.port ?? KANATA_PORT;
  const log = options.log ?? KANATA_SERVICE_LOG;
  const args = [
    options.kanata,
    "--cfg",
    options.config,
    "--port",
    `${KANATA_HOST}:${port}`,
    "--no-wait",
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${KANATA_SERVICE_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((arg) => `    <string>${escapeXml(arg)}</string>`),
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(log)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(log)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** sudo と launchctl の実行結果。 */
export interface ServiceResult {
  readonly ok: boolean;
  readonly output: string;
}

/**
 * launchd と sudo の境界。
 *
 * @doc docs/specs/mac-keymap.md#servicehost
 */
export interface ServiceHost {
  /** plist が置かれているか。 */
  installed(): Promise<boolean>;
  /** `sudo install -m 0644 -o root -g wheel <source> <plist>`。 */
  install(source: string): Promise<ServiceResult>;
  /** 登録済みなら外してから `sudo launchctl bootstrap system <plist>` で登録し直す。 */
  bootstrap(): Promise<ServiceResult>;
  /** `sudo launchctl kickstart -k` で kanata を起動し直す。掴むデバイスを決め直すのに使う。 */
  restart(): Promise<ServiceResult>;
}

/**
 * 実物の sudo と launchctl を呼ぶ `ServiceHost`。
 *
 * @doc docs/specs/mac-keymap.md#servicehost
 */
export function createServiceHost(): ServiceHost {
  return {
    async installed() {
      try {
        await access(KANATA_SERVICE_PLIST);
        return true;
      } catch {
        return false;
      }
    },
    install: (source) =>
      interactive("sudo", [
        "install",
        "-m",
        "0644",
        "-o",
        "root",
        "-g",
        "wheel",
        source,
        KANATA_SERVICE_PLIST,
      ]),
    async bootstrap() {
      // 未登録なら bootout は失敗する。結果は見ない。
      await interactive("sudo", ["launchctl", "bootout", `system/${KANATA_SERVICE_LABEL}`]);
      return await interactive("sudo", ["launchctl", "bootstrap", "system", KANATA_SERVICE_PLIST]);
    },
    restart: () =>
      interactive("sudo", ["launchctl", "kickstart", "-k", `system/${KANATA_SERVICE_LABEL}`]),
  };
}

/**
 * 端末を引き継いで実行する。sudo のパスワード入力は端末で行う。
 *
 * stdout は JSON の出力と混ざらないよう stderr へ回す。
 */
function interactive(command: string, args: readonly string[]): Promise<ServiceResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
    let output = "";
    const forward = (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    };
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("error", (error) => resolve({ ok: false, output: error.message }));
    child.on("close", (code) => resolve({ ok: code === 0, output: output.trim() }));
  });
}
