# Local server

`just ui`が起動するローカルサーバーの仕様です。
判断はADR 0033（配布をローカルサーバーへ寄せる）、ADR 0034（Macの適用API）、ADR 0038（workspaceのファイルAPI）にあります。

サーバーは`src/server/`にあり、Nodeで動きます。
Web UIのコード（`src/ui/`）からは呼び出さず、HTTPだけで接続します。

<!-- @code src/server/main.ts#createUiServer -->

## createUiServer

`dist/`を配信し、`/api/`配下を`createApiHandler`へ渡すHTTPサーバーを作ります。
listenは呼び出し側が行います。
起動時のworkspaceは`defaultWorkspaceRoot`が決め、起動時に絶対pathを表示します。

| 項目   | 値                                                     |
| ------ | ------------------------------------------------------ |
| bind   | `127.0.0.1`だけ。LANからは届かない                     |
| port   | `5178`で固定。使用中なら理由を出して終了する           |
| method | 静的配信は`GET`と`HEAD`だけ。それ以外は405             |
| 起動後 | `open -a "Google Chrome"`で開く。失敗してもURLだけ表示 |

portを固定するのは、originにportが入るためです。
変わるとテーマの保存とWebHIDのdevice権限が起動のたびに消えます。

<!-- @code src/server/api.ts#createApiHandler -->

## createApiHandler

`/api/`配下のリクエストを受けます。
`just ui`のサーバーと、`just dev`のVite開発サーバーのmiddlewareが同じものを使います（ADR 0038）。
`rejectApiRequest`を通ったものだけをAPIへ渡します。
本文は16 MiBまでで、JSONとして読めなければ400を返します。
workspaceへ書くPDFとdefinitionを、base64にして載せるためです。

| 起動       | origin                  |
| ---------- | ----------------------- |
| `just ui`  | `http://127.0.0.1:5178` |
| `just dev` | `http://127.0.0.1:5173` |

<!-- @code src/server/api.ts#createLocalApi -->

## createLocalApi

workspaceのファイルAPIとMacの適用APIを1つにまとめます。
どちらも同じworkspace rootを使います。

<!-- @code src/server/static.ts#serveStatic -->

## serveStatic

URLのpathを`dist/`配下のファイルへ解決して読みます。
`/`は`index.html`です。

- `dist/`の外を指すpath（`..`や符号化した区切り）は404にします。
- 配信する拡張子は`vite build`が出すものだけで、それ以外は404にします。
- `index.html`は`no-cache`、hash付きのassetは`immutable`で返します。
  起動し直した後のreloadで新しいbuildが必ず見えるようにするためです。

<!-- @code src/server/guard.ts#rejectApiRequest -->

## rejectApiRequest

`/api/`配下へのリクエストを、ヘッダーだけで受けるか決めます（ADR 0034）。
拒否すると403と`{kind: "rejected", reason}`を返します。

| 確認             | 条件                       | 防ぐもの        |
| ---------------- | -------------------------- | --------------- |
| method           | `POST`だけ                 | —               |
| `Content-Type`   | `application/json`だけ     | form からの送信 |
| `Host`           | originのauthorityと一致    | DNS rebinding   |
| `Origin`         | originと一致。無ければ拒否 | CSRF            |
| `Sec-Fetch-Site` | `same-origin`だけ          | CSRF            |

守る相手はブラウザで開いている別のサイトです。
同じマシンで同じユーザーとして動く別のプロセスは対象外にします。
そのプロセスはkanataの設定ファイルを直接書けるので、APIを守っても防げません。
起動ごとのトークンを持たないのはこのためです。

<!-- @code src/server/mac-api.ts#createMacApi -->
<!-- @code src/server/protocol.ts#MAC_API -->

## createMacApi

Macの適用APIです。
手順はCLIと同じ`src/mac/apply-service.ts`を通ります（`mac-keymap.md`の「適用の境界」）。
呼び出しは1本ずつ直列に処理します。

| path              | 本文                            | 行うこと                                        |
| ----------------- | ------------------------------- | ----------------------------------------------- |
| `/api/mac/status` | `{}`                            | このマシンの内蔵配列とworkspaceを返す           |
| `/api/mac/plan`   | `{layout, digest}`              | 計画を組み、差分とfingerprintを返す             |
| `/api/mac/apply`  | `{layout, digest, fingerprint}` | 計画を組み直し、fingerprintが一致したら適用する |

計画を組む前に、次の順で突き合わせます。
どれかで止まったらkanataの設定ファイルには触れません。

1. 編集対象の配列が、このマシンの内蔵配列（`detectBuiltInLayout`）と一致する
2. その配列の設定ファイルがある
3. Web UIが送った`digest`が、ディスクから読んだ設定の`macKeymapDigest`と一致する
4. error診断が無い
5. kanataが入っている
6. `kanata --check`が通る

`apply`は計画を組み直し、fingerprintが違えば書かずに新しい計画を`fingerprint-mismatch`で返します。
計画には、kanataが常駐していてReloadできるか（`running`）を添えます。
書き込みとverifyの後にReloadだけが失敗したら、巻き戻さずに`reload-failed`を返します。
kanataが常駐していなければ、書き込んだうえで`applied`の`reloaded`を`false`にします。
想定外の例外は500と`{kind: "failed", message}`にします。

<!-- @code src/server/workspace-api.ts#createWorkspaceApi -->
<!-- @code src/server/workspace-api.ts#workspacePath -->
<!-- @code src/server/protocol.ts#WORKSPACE_API -->

## createWorkspaceApi

workspaceのファイルAPIです。
Web UIはdirectoryを選ばず、これでサーバーのworkspaceを読み書きします（ADR 0038）。
中身は`NodeWorkspaceStore`の操作をそのままHTTPへ出したものです。

| path                    | 本文             | 行うこと                                     |
| ----------------------- | ---------------- | -------------------------------------------- |
| `/api/workspace/status` | `{}`             | workspaceの絶対pathを返す                    |
| `/api/workspace/read`   | `{path}`         | 中身をbase64で返す。無ければ`null`           |
| `/api/workspace/stat`   | `{path}`         | 更新時刻とcontent hashを返す。無ければ`null` |
| `/api/workspace/write`  | `{path, base64}` | 親directoryを作って書く                      |
| `/api/workspace/mkdir`  | `{path}`         | directoryを作る                              |

`path`はworkspace rootからの相対pathです。
`workspacePath`が次を拒否し、`{kind: "failed", message}`を返します。

- `..`、`.`、空の区切り、`\`を含むpath
- workspaceの配置（`workspace-cli.md`の「配置」）の外

root直下で扱えるのは`keymap.yaml`と`mac-keyboard*.yaml`だけです。
directoryは`keysync/`と、移行が読む改名前の`cornix/`だけです。
Web UIの不具合でrepositoryの他のファイルを書き換えないためです。
