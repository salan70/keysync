import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseKanataList, parseReloadResult } from "./node.ts";
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

test("parseKanataList は表の行だけを読み、Karabiner の仮想キーボードを外す", () => {
  // 2026-09-30 に内蔵キーボードだけの MacBook で kanata --list が出した内容。
  const observed = readFileSync(
    join(import.meta.dirname, "../../fixtures/mac-keyboard/kanata-list.txt"),
    "utf8",
  );
  deepStrictEqual(parseKanataList(observed), [
    { name: "Apple Internal Keyboard / Trackpad", vendorId: 0, productId: 0 },
  ]);
  // 外付けは同じ表に、名前に空白を含んだまま並ぶ。
  deepStrictEqual(
    parseKanataList("0x1234ABCD           76         614        Magic Keyboard with Touch ID  \n"),
    [{ name: "Magic Keyboard with Touch ID", vendorId: 76, productId: 614 }],
  );
});
