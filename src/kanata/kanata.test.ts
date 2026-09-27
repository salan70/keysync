import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { parseReloadResult } from "./node.ts";
import { KANATA_SERVICE_LABEL, kanataServicePlist } from "./service.ts";

test("parseReloadResult は ReloadResult と Error だけを結果にする", () => {
  deepStrictEqual(parseReloadResult('{"ReloadResult":{"ok":true}}'), { kind: "reloaded" });
  deepStrictEqual(parseReloadResult('{"ReloadResult":{"ok":false,"timeout_ms":5000}}'), {
    kind: "failed",
    output: '{"ReloadResult":{"ok":false,"timeout_ms":5000}}',
  });
  deepStrictEqual(parseReloadResult('{"Error":{"msg":"bad"}}'), {
    kind: "failed",
    output: '{"Error":{"msg":"bad"}}',
  });
  // Reload の前に届く別の通知は読み飛ばす。
  strictEqual(parseReloadResult('{"LayerChange":{"new":"base"}}'), undefined);
  strictEqual(parseReloadResult("not json"), undefined);
});

test("launchd の plist は kanata を設定と TCP の port 付きで常駐させる", () => {
  const plist = kanataServicePlist({
    kanata: "/opt/homebrew/bin/kanata",
    config: "/Users/me/Library/Application Support/keysync/kanata.kbd",
    port: 5179,
    log: "/var/log/keysync-kanata.log",
  });
  strictEqual(plist.includes(`<string>${KANATA_SERVICE_LABEL}</string>`), true);
  strictEqual(
    plist.includes(
      [
        "    <string>/opt/homebrew/bin/kanata</string>",
        "    <string>--cfg</string>",
        "    <string>/Users/me/Library/Application Support/keysync/kanata.kbd</string>",
        "    <string>--port</string>",
        "    <string>127.0.0.1:5179</string>",
        "    <string>--no-wait</string>",
      ].join("\n"),
    ),
    true,
  );
  strictEqual(plist.includes("<key>KeepAlive</key>\n  <true/>"), true);
  strictEqual(kanataServicePlist({ kanata: "/a&b", config: "/c<d>" }).includes("/a&amp;b"), true);
});
