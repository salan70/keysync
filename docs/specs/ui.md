# Web UI

UI は Vite + React + TypeScript で、外部の router と store を持たない。
目標状態の mutable な値は workspace 単位で持ち、編集は Core の純関数へ委譲する。
画面の構成と部品の境界は ADR 0031（uiux-numa `cornix-workbench` の `board-desk`）に従う。

<!-- @code src/ui/theme.ts#ThemePreference -->
<!-- @code src/ui/theme.ts#parseThemePreference -->
<!-- @code src/ui/theme.ts#loadThemePreference -->
<!-- @code src/ui/theme.ts#saveThemePreference -->
<!-- @code src/ui/theme.ts#resolveTheme -->
<!-- @code src/ui/theme.ts#applyTheme -->

## Light / Dark theme

テーマは `system` / `light` / `dark` の 3 択で、選択をブラウザの localStorage へ保存する。
初回、不正値、保存へのアクセス失敗のときは `system` へ戻る。
`system` は `prefers-color-scheme` へ追従し、明示した `light` / `dark` は OS 設定の変更に影響されない。
実効テーマは `document.documentElement` の `data-theme="light"` / `data-theme="dark"` へ反映し、CSS token を切り替える。
初回の描画より前に属性を決め、最初だけ違う配色で描かれるのを避ける。

配色は uiux-numa の `color-schemes-material` で採用した `pop-toy` の 24 役割を `src/ui/styles/tokens/color.css` に写したものである。
出典は prefers-color-scheme で明暗を切り替えるが、本体は `data-theme` 属性で切り替える。
keycode の種類、layer の色、実機との差分の印などの本体固有の token は、24 役割だけから同じファイルで派生させる。
強調色（primary / secondary / tertiary）で面を塗り分けてカラフルにするが、良し悪しの色（success / warning / error）は状態だけに使い、強調色と混ぜない。
状態は色だけで区別せず、文字、記号、境界、形を併用する。
Light の黄の塗りは白の面に 1.61:1 しかないため、選択は塗りに加えて太い二重の輪で示す。
本文と主要な操作の文字は 4.5:1、focus と操作の境界は 3:1 以上のコントラストを保つ。
寸法と書体の token、cascade layer の構成、Button の契約は [design-system.md](./design-system.md) を参照する。

<!-- @code src/ui/icon-style.ts#IconStyle -->
<!-- @code src/ui/icon-style.ts#parseIconStyle -->
<!-- @code src/ui/icon-style.ts#loadIconStyle -->
<!-- @code src/ui/icon-style.ts#saveIconStyle -->
<!-- @code src/ui/icon-style.ts#applyIconStyle -->

## Icons

機能アイコンは uiux-numa の `cornix-ui-icons` で描いたキーキャップ型の 2 組で、ADR 0032 に従う。
見た目は `dish`（凹みあり、`keycap-dish-fill`）と `flat`（凹みなし、`keycap-squircle`）の 2 択で、既定は `dish` である。
選択はブラウザの localStorage の `keysync.icon-style` へ保存し、初回、不正値、保存へのアクセス失敗のときは `dish` へ戻る。
選んだ見た目は `document.documentElement` の `data-icon-style` に反映し、描画中のすべての icon を描き直す。
設定はファイルのパネルの「表示」にラジオボタンで置き、各選択肢に見本の icon を添える。
header には置かず、1024px 幅でも header を 1 行に保つ。

icon は読み上げから外し、意味は隣の語か操作の `aria-label` が持つ。
icon を置く場所と大きさは次のとおりである。

| 場所                                                          | icon                                                                            | 大きさ |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| 左端の入口                                                    | `keymap` `overview` `behaviors` `validation` `device` `files`                   | 20px   |
| status bar の診断件数、検証パネルの行、Apply の warning       | `error` `warning` `info`                                                        | 16px   |
| Apply と実機パネルの「error があるため…」                     | `error`                                                                         | 16px   |
| 編集パネルの保存状態                                          | 保存中 `saving`、保存済み `check`、失敗 `error`、競合 `warning`、変更なしは無し | 16px   |
| パネルの見出しの操作                                          | `expand` `collapse` `close`                                                     | 16px   |
| encoder の帯の回転方向                                        | `rotate-ccw` `rotate-cw`                                                        | 16px   |
| 編集パネルの「layer を開く」                                  | `arrow-right`                                                                   | 16px   |
| Apply の完了した段階、backup 済み、書き込みの行、完了の見出し | `check`、書き込み中の行は `saving`                                              | 16px   |

保存中の icon は 3 つの点で、回さない。
変更なしの保存状態は icon を出さず、文言の位置を揃えるために icon の幅だけを空ける。

次の記号は icon に置き換えない。

- keycap の刻印記号（⌘ ⌥ ⌃ ⇧ ⏎ など）。macOS と Vial の慣習に従う
- CSS で描いた点（接続状態、差分、layer の色点）
- 盤面の小さな診断の印（× と !）
- 全体マップの参照元の「←」と、読み上げから外した mini 盤面の ↺ ↻
- 文中の差分の「→」、件数の「×」、動作定義の保存失敗の「×」

<!-- @code src/ui/server-workspace.ts#openServerWorkspace -->

## Workspace入口

Web UI は directory を選ばない（ADR 0038）。
起動するとローカルサーバーへ workspace を訊き、その workspace を開く。
ファイルの読み書きはすべてサーバーの workspace API（`local-server.md`）を通す。
`keymap.yaml` が無くても workspace は開ける。

サーバーへ届かないときは、入口に「ローカルサーバーに接続できない」と `just ui` での起動を出す。
サーバーが拒否したときや読めなかったときは、入口に理由を出す。
workspace API を持たない古いサーバー（起動中に `dist/` だけを作り直した）には、`just ui` の起動し直しを案内する。
どちらも「もう一度開く」で開き直せる。
keymap の保存は workspace adapter の競合検出を通す。

<!-- @code src/workspace/bootstrap.ts#planWorkspaceInit -->
<!-- @code src/workspace/bootstrap.ts#writeWorkspacePlan -->

## Workspace初期化

Cornix を初期化するときは、実機の full read から `keymap.yaml` と `keysync/definitions/<digest>.json` を作る。
CLI の `import vil` と同じ組み立てを browser 側で行うもので、実機へは書き込まない。
workspace を開くこと自体は `keymap.yaml` を要求しない。
definition を先に書き、途中で中断しても「binding が指す先が無い」状態を作らない。

<!-- @code src/workspace/bootstrap.ts#planBindingMigration -->

## 旧bindingの移行

definition の content-addressing は canonical 表現の SHA-256 で行う。
この規則より前に作られた workspace はファイルの bytes をそのまま digest しているため、`readDefinitionBinding` が digest 不一致で落ちる。

保存されている bytes の digest が `keymap.yaml` の digest と一致することは、definition が記録当時と同じ内容である証明になる。
この場合に限り、実機も `.vil` も使わず binding を canonical 規則へ移行できる。
一致しない場合は移行しない。
digest 不一致は keymap と definition の取り違えの検出手段でもあるため、移行は自動では行わずユーザーの明示操作にする。

UI は読み込み失敗を例外の文字列のまま出さず、`keymap.yaml` が無い場合、旧 binding の場合、改名前の管理ディレクトリの場合、それ以外を区別して、それぞれの復旧操作を提示する。

<!-- @code src/workspace/bootstrap.ts#planLayoutMigration -->
<!-- @code src/workspace/bootstrap.ts#writeLayoutMigration -->

## 旧ディレクトリの移行

改名（ADR 0035）で管理ディレクトリは `cornix/` から `keysync/` に変わった。
`readDefinitionBinding` は path が `definitionPath(digest)` と一致することを要求するため、`cornix/definitions/` を指す `keymap.yaml` は読めない。

binding の path が `cornix/definitions/<digest>.json` で、そのファイルの digest が binding と一致するときに限り移行を提示する。
digest は変わらないので、`keymap.yaml` は path だけが変わる。
写すのは definition と、`labels.yaml`、`acknowledgements.json` で、`keysync/` に既にあるものは上書きしない。
`backups/` と `generated/` は生成物なので写さず、旧 `cornix/` も削除しない。

書く順は definition、sidecar、`keymap.yaml` である。
`keymap.yaml` を最後に書くので、途中で中断しても旧 path を指したまま旧 `cornix/` も残り、同じ移行をやり直せる。
`keysync/` と `cornix/` の両方を読むフォールバックは置かず、移行はユーザーの明示操作にする（ADR 0036）。
CLI の `keysync migrate` も同じ関数を通る。

<!-- @code src/ui/components/index.ts#App -->

## 画面構成

画面は header、左端の入口（rail）、机（desk）、status bar の 4 領域で組む。
机には layer の切替、盤面、keycode picker、編集パネルを常に同じ位置へ置き、連続した割り当てを妨げない。
全体マップ、動作定義、検証、実機と適用、ファイルは、左端の入口から画面中央のパネルで開く。
Apply だけは段階を終えるまで他の作業へ移れない modal として、パネルと区別する。
workspace を開く前は header（brand、テーマ）と入口だけを出す。
1280 × 800 と 1024 × 768 で横スクロールを出さず、header は折り返さない。
幅 1100px 以下では編集パネルを狭め、picker の行を低くし、header の余白を詰める。
`App` は状態の hook を組み合わせ、部品へ値と操作を渡すだけにする。

<!-- @code src/ui/state/use-workspace.ts#useWorkspace -->
<!-- @code src/ui/state/use-cursor.ts#useCursor -->
<!-- @code src/ui/state/use-device.ts#useDevice -->
<!-- @code src/ui/state/use-apply-gate.ts#useApplyGate -->
<!-- @code src/ui/state/use-apply.ts#useApply -->
<!-- @code src/ui/state/use-theme.ts#useTheme -->
<!-- @code src/ui/state/use-icon-style.ts#useIconStyle -->
<!-- @code src/ui/state/use-status.ts#useStatus -->

## 状態の持ち方

状態は関心ごとの hook に分け、各 hook は他の hook の内部を読まない。
hook の間の受け渡しは `App` が引数と callback で行う。

| hook           | 持つもの                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `useWorkspace` | workspace、Cornix と Mac の目標状態、表示名、acknowledge、ファイルごとの保存キューと保存状態、復旧 |
| `useCursor`    | 編集対象と、対象ごとの layer、選択、picker の適用先                                                |
| `useDevice`    | WebHID の接続、最後の full read の結果、definition の digest、往復回数、読込の進捗                 |
| `useApplyGate` | 実機の現在状態と目標状態の差分、Apply gate                                                         |
| `useApply`     | Apply の段階、Core の `ApplyState`、書き込みの往復回数、中断の要求                                 |
| `useTheme`     | テーマの選択                                                                                       |
| `useIconStyle` | 機能アイコンの見た目の選択                                                                         |
| `useStatus`    | status bar の通知と往復の進捗                                                                      |

保存キューは workspace を採用するたびに作り直し、世代番号で古いキューの通知を捨てる。
実機の切断、再接続、読み直しの開始では `useDevice` が `onStale` を呼び、`App` が Apply の途中状態を捨てる。
Mac の layer 番号空間は Vial と別なので、編集対象を切り替えても互いの layer と選択を上書きしない。
layer を切り替えても選択中の位置は保ち、同じ位置を layer ごとに続けて割り当てられるようにする。

<!-- @code src/ui/components/index.ts#Header -->
<!-- @code src/ui/components/index.ts#StatusBar -->

## Header and status

header は brand（ロゴと「KeySync」、[design-system.md](./design-system.md#logo)）、編集対象の radiogroup、Cornix LP の接続状態、テーマを 1 行に常設する。
編集対象は `Cornix LP`、`Mac ANSI`、`Mac JIS` の radiogroup で、方向キーでも切り替えられる。
各対象には読込状態の印（読込済み、ファイルなし、移行が必要、読込失敗）を形と色で付け、文言を読み上げ用に添える。
接続状態は色だけに頼らず、未接続、接続済み、読込中、読込済みと製品名を文字で示す。

status bar は severity ごとの診断件数、保存状態と保存先、通知、実機との差分と Apply の入口を出す。
診断件数を押すと、その severity で絞り込んだ検証パネルを開く。
保存状態は Cornix では `keymap.yaml` と `keysync/labels.yaml` を `chooseSaveCandidate` の優先順（conflict > error > saving > saved > idle）で 1 つにまとめ、保存先ファイルと並べる。
Cornix 表示中は実機との差分件数（未読込ならその旨）と「実機へ Apply…」を出す。
Apply を開始できないときはボタンを無効にし、理由（`keymap.yaml` 未読込、未接続、未読込、差分 0 件、error あり）を文字で並べる。
Mac 表示中は Vial の差分件数と Apply を出さず、「Karabiner へ適用…」と、押せないときの理由を出す（Mac apply を参照）。
Apply の gate と診断の severity を UI 表示上で混同しない。

<!-- @code src/ui/components/index.ts#Rail -->
<!-- @code src/ui/components/index.ts#PanelDialog -->
<!-- @code src/ui/types.ts#PanelId -->

## Rail and panels

左端の入口は `割り当て`、`全体`、`動作`、`検証`、`実機`、`ファイル` の順に固定する。
入口はすべて同じ大きさにする。
選んだ対象で使えない入口は位置を動かさず、`aria-disabled` にして理由（Mac では「Cornix のみ」、Cornix を読み込めていなければ「keymap.yaml 未読込」）を読み上げだけに渡す。
検証の入口には error と warning の件数、実機の入口には読込済みのときの差分件数を添える。

パネルは native の `<dialog>` を `showModal()` で画面中央に開き、開いたら見出しへ focus を移す。
Esc、×、背景の押下でいつでも閉じられる。
開いている間は背後が inert になるため、閉じた後の focus の移動（開いた入口へ戻す、盤面へ移る）は閉じた描画の後の effect で行う。
パネルごとに標準と全画面を切り替えられ、全画面にしたパネルは同じ session の中で次も全画面で開く。
パネルは modal なので、開いたまま編集対象は切り替わらない。

<!-- @code src/ui/components/index.ts#CornixLayerBar -->
<!-- @code src/ui/components/index.ts#CornixBoard -->
<!-- @code src/render/geometry.ts#KeyShape -->
<!-- @code src/render/geometry.ts#keyBox -->
<!-- @code src/render/geometry.ts#boardMetrics -->
<!-- @code src/render/geometry.ts#fitUnit -->
<!-- @code src/ui/use-board-scale.ts#useBoardScale -->
<!-- @code src/ui/use-board-scale.ts#useStageScale -->

## Keymap editor

盤面は definition 由来の物理座標を HTML/CSS の絶対配置へ投影する。
座標から px への投影は `src/render/geometry.ts` が唯一の定義元で、盤面、全体マップ、SVG / PDF export が同じ関数を消費する。
geometry が読むのは `KeyShape`（x / y / width / height / rotation）だけで、matrix の概念に依存しない。
`PhysicalKey`（Vial matrix 由来）も matrix を持たない盤面（Mac 内蔵キーボード）も構造的部分型として同じ関数へ渡す。
`transform-origin` は要素自身の box 基準で解決されるため、回転中心は盤面座標ではなくキーからの相対値で渡す。
盤面の外接矩形は回転後の四隅から求め、回転したキーがはみ出さない大きさにする。

表示倍率は固定せず、盤面の台（stage）の実測から 1u の px を 30〜52px の範囲で決める。
測るのは grid の行と列で大きさが外から決まる台で、盤面自身の大きさで決まる要素は測らない。
盤面自身を測ると、倍率が自分の出力へ依存するためである。
台の高さからは padding と encoder の帯の高さを引き、帯の高さは倍率に依らない。
計測は paint 前に行い、初回だけ違う倍率で描かれないようにする。
keycap の文字の大きさも同じ倍率へ連動させ、収まらない文字は `FitText` が縮め、全文は title と編集パネルで出す。

keycap には keycode の語彙に応じた basic / mod / mod-tap / layer / layer-tap / tapdance / custom / none の種類の class（`kind-*`）を付け、強調色の container で塗り分ける。
選択中のキーは種類に関係なく同じ見た目（黄の塗り、濃い枠、二重の輪）にする。
実機との差分がある位置には点、error と warning の診断がある位置には印を付け、どちらも読み上げの文言に含める。
encoder は物理キーと混ぜず、実機が申告した本数から専用の帯を組み立て、各 slot の幅を keycode の表示名に依存させない。
盤面は roving tabindex で、方向キーで幾何的に隣のキーへ選択と focus が移り、Enter で編集パネルの見出しへ、編集パネルの Esc で盤面へ戻る。

layer の切替は layer 番号と名前の chip で、番号の順に強調色 3 色を巡らせる。
参照元の無い layer は畳み、選択中の layer は常に出す。

<!-- @code src/ui/components/index.ts#Inspector -->
<!-- @code src/ui/save-state.ts#SaveState -->
<!-- @code src/ui/save-state.ts#chooseSaveCandidate -->
<!-- @code src/ui/save-state.ts#saveFailureState -->

## Side panel editing controls

編集パネルは選択中のキーまたは encoder の位置、keycap、raw keycode、挙動の説明を常設する。
layer を指す keycode は参照先の layer 名と番号を示し、押すとその layer を開く。
picker の適用先（キー全体、Tap、Hold）は segmented の radio で、各適用先の現在値を併記する。
動作 select は既存 keycode の分類を使い、Cornix は `BEHAVIOR_OPTIONS`、Mac は `basic` / `modified` / `modTap` / `layerSwitch` / `none` に絞る。
raw keycode と表示名は折りたたみの中に置く。
raw keycode は Enter または「反映」で保存し、Mac では空欄を素通しへ戻す操作として扱う。
表示名（任意）は raw keycode 式へ完全一致で割り当て、Enter または blur で `keysync/labels.yaml` へ保存し、空欄はその式の表示名を削除する。
Mac では「割り当てを外す（素通しへ戻す）」を置く。

編集パネルの下端には、対象ファイルとともに保存中、ローカル保存済み、保存失敗、外部変更との競合を記号と文言で出す。
通常の I/O 失敗は再試行でき、外部変更との競合は再試行を出さず、未保存の編集が失われた警告と再読込の導線を出す。
ここで示す保存はローカルの workspace への保存で、実機への反映は Apply、Mac への適用は「Karabiner へ適用」だと併記する。

<!-- @code src/ui/components/index.ts#Picker -->
<!-- @code src/ui/keycode-compose.ts#applyPick -->

## Keycode picker

盤面の下に keycode picker を常設し、Vial に倣って `基本` `レイヤー` `メディア・マウス` `特殊` のタブで面を切り替える（ADR 0041）。
既定は `基本` で、タブの状態は picker の中だけで持つ。
全タブを同じ格子に重ねて描き、表示中以外は `visibility: hidden` と `inert` にする。
picker の高さは最も高い面で決まり、タブを切り替えても盤面の位置は動かない。
全タブを 26u の固定座標で描き、キーの位置と幅は 26u に対する百分率で決め、狭い画面でも横スクロールを発生させない。

`基本` は Vial の ISO/JIS 面に合わせた 6 行の物理配列にする。
main は 0〜16u、navigation は 18〜21u、numpad は 22〜26u へ置く。
navigation は 3u の逆 T 字、numpad は 4u の cluster とし、numpad 右端を下部 26u ストリップの右端へ揃える。
ISO Enter の行跨ぎは再現せず、3 段目末尾へ 2.25u で置き、4 段目末尾は spacer にする。
下部には `KC_NO`、`KC_TRNS`、shift 済み記号、`LANG1` / `LANG2` を並べる 26u のストリップを描く。

`基本` 以外のタブは、先頭 3u に行の見出しを置き、keycode を同じ幅で左から並べて列を縦に揃える。
keycode の幅は 2u を上限に、最も長い行が 26u に収まるまで縮める。
行数は `基本` の行数（物理配列 6 行と記号の帯）以内に収める。

`レイヤー` は行を `MO` `TG` `TT` `TO` `DF` `OSL`、列を呼び出し側が渡す layer 番号にし、見出しの下に動きの短い説明を添える。
Cornix は layer 数、Mac は document に書かれた layer 番号を渡す。
`メディア・マウス` は音量、再生、画面（輝度・Mission Control など）、電源・アプリ、ブラウザ、マウス、ホイールの行に分ける。
`特殊` は F13〜F24、Grave Escape、Space Cadet、`CAPS_WORD`、Leader、Repeat、`LANG3` 以降と `INT6` 以降を並べる。
`RESET` `QK_BOOT` `EE_CLR` `DEBUG` はどのタブにも置かない。

各キーの表示は共通の keycode label 関数から描き、表示名があればそれを主表示にし、raw 式は title で確認できる。
modifier のキーは mod の色で塗る。

picker の現在値は適用先に合わせて強調する。
Hold では modifier keycode と `MO(n)` だけを有効にし、modifier は Vial 形式の `X_T(kc)`、`MO(n)` は `LTn(kc)` へ組み立てる。
Hold の現在値は、`LTn(kc)` のとき `MO(n)` として強調する。
無効にした cell は title と読み上げで理由（Hold に選べるのは modifier と MO だけ、Karabiner で表現できない）を示す。
編集対象が未選択なら picker の全 cell を無効にする。

picker は選択中の編集対象が何か（key / encoder / Mac の盤面位置）を知らない。
現在値の `selectedKeycode` を受け取り、選ばれた keycode を生のまま通知する。
`applyPick` での合成と保存先の分岐は呼び出し側の責務にする（ADR 0025）。
Mac は `macKeycodeSupport` を渡し、Karabiner へ落とせない cell を無効にする。
判定表は UI へ複製しない。

<!-- @code src/ui/components/index.ts#MacLayerBar -->
<!-- @code src/ui/components/index.ts#MacBoard -->
<!-- @code src/ui/mac-workspace.ts#probeMacKeymap -->
<!-- @code src/ui/mac-board.ts#macBoardEntries -->
<!-- @code src/ui/mac-keycap-labels.ts#macKeycapLabel -->

## Mac board

物理配列ごとの `mac-keyboard.<layout>.yaml` を編集する。
workspace の必須ファイルではない。
状態は配列ごとに `ready` / `missing` / `error` へ閉じる（ADR 0025 / 0027）。

- `ready`: その配列の物理盤面（`macPhysicalLayout`）を描画し、割り当てを編集する
- `missing`: 盤面の位置に復旧を出し、選んだ配列と空の layer 0 だけを持つ初期ファイルを作れる
- `error`: 盤面の位置に parse 失敗の理由と再読込を出す

読み込みは `probeMacKeymap(store, layout)` が `readMacKeymapFor` を使う。
旧名 `mac-keyboard.yaml` は中の `layout` 宣言で解決する。
parse 失敗は `error` に閉じ込め、例外を外へ出さない。
保存キューは ready な配列ごとに 1 本持つ。

盤面は Cornix と同じ geometry（`KeyShape`）で描く。
entry は `macBoardEntries` が物理配列を正として組む。
割り当ての無いキーは素通しとして物理キャップ名を破線の枠で出す。
選択は `{kind: "macKey", keyCode}` で、layer 番号空間は Vial と別に持つ。
layer の切替は疎な layer 番号をそのまま並べ、「+ layer N を追加」を置く。

keycode の選択は同じ picker を使い、`applyPick` の合成と `setMacAssignment` での保存は `App` が持つ。
keycode 表示は Vial と同じ label 関数を使うが、layer 名は剥がして渡し、`createKeycodeTable` は呼ばない。
診断は `validateMacKeymap` の結果を Vial 側と分けて持ち、盤面の印、検証パネル、status bar の件数はすべて Mac の診断で描く。
Karabiner への適用はローカルサーバーが行い、Web UI は差分を見せて承認を送るだけである（ADR 0034）。

<!-- @code src/ui/components/index.ts#MacApplyDialog -->
<!-- @code src/ui/state/use-mac-apply.ts#useMacApply -->
<!-- @code src/ui/mac-apply-gate.ts#macApplyBlockedReason -->
<!-- @code src/ui/mac-server.ts#fetchMacStatus -->

## Mac apply

「Karabiner へ適用…」は、ローカルサーバーの適用 API（`local-server.md`）を呼んで `karabiner.json` を書き換える。
Web UI は `karabiner.json` にも `karabiner_cli` にも触れず、同じ origin へ JSON を POST するだけである（ADR 0034）。

起動時に 1 回だけ、このマシンの内蔵配列をサーバーへ訊く。
サーバーへ届かない（サーバーを止めた、静的配信だけで開いた）ときは `unreachable` として扱う。

押せない理由は `macApplyBlockedReason` が次の順で 1 つだけ返す。
前のものが解決しないと後ろを直しても押せないためである。

| 順  | 条件                             | 表示                                                 |
| --- | -------------------------------- | ---------------------------------------------------- |
| 1   | サーバーへ問い合わせ中           | サーバーに問い合わせ中                               |
| 2   | サーバーへ届かない               | サーバーに接続できない。just ui で起動する           |
| 3   | 配列を検出できない               | この Mac の配列を検出できない                        |
| 4   | 編集対象の配列がこのマシンと違う | この Mac は ANSI。JIS の設定は JIS の Mac で適用する |
| 5   | 設定ファイルが ready でない      | 設定ファイルを読み込めていない                       |
| 6   | 保存待ち                         | 保存中…                                              |
| 7   | 保存失敗・外部変更の競合         | 保存できていない                                     |
| 8   | error 診断がある                 | error があるため適用できない                         |

押すと、編集中の document の `macKeymapDigest` を添えて計画を頼み、modal に差分を出す。
差分は layer、キー（物理キャップ名）、割り当て（QMK 表記）、追加 / 変更 / 削除で並べ、error 以外の診断（改名前の profile が残っている案内を含む）を添える。
差分が無く profile の切り替えも要らなければ「このマシンは最新」と出し、適用ボタンを無効にする。

計画の段階で止まったときは、`karabiner.json` に触れていないと明示して理由を出す。
digest が一致しないときは、画面の内容とサーバーが読んだファイルの絶対 path が違うと示し、再読込を置く。
保存の途中や、外部エディタや Git で書き換えた後に古い画面から適用するのを止めるためである。

適用すると、計画の fingerprint を送り返す。
計画の後に内容が変わっていれば、サーバーが返した新しい計画を見せ直す。
結果は次のとおり出す。

| 結果                       | 表示                                                           |
| -------------------------- | -------------------------------------------------------------- |
| 適用した                   | backup の path と、profile を切り替えたこと                    |
| verify が一致しない        | backup から戻す手順                                            |
| profile の切り替えだけ失敗 | 書き込みは巻き戻していないこと、「切り替えを再試行」、戻す手順 |
| 想定外の失敗               | 理由と、適用前の設定は `keysync/backups/` にあること           |

計画中と適用中は modal を閉じられない。

<!-- @code src/ui/keycode-labels.ts#keycodeDisplay -->
<!-- @code src/core/keycode/shifted.ts#shiftedOf -->

## Keycode labels

keycode の表示は wire encode 用の表記とは分離し、`SHORT_LABELS` で Vial の刻印へ寄せる。
numpad、shift 済み記号、JIS 固有キー（`JYEN`、`KANA`、`HENK`、`MHEN`、`LANG1`、`LANG2`）は刻印を優先する。
純粋な `LSFT` / `RSFT` wrapper は入力結果の記号だけを表示し、`SGUI` など複合 modifier は既存の modifier 表示を維持する。
mod-tap / layer-tap の Hold 値は下段に示し、`hold` という文字自体は表示しない。
shift keycode の base / shifted 対応は core の単一定義元から picker と盤面 keycap の両方へ提供し、ラベル表を複製しない。
workspace の表示名はこの既定表示より優先するが、編集パネル、Apply、SVG / PDF では表示名と raw 式を併記する。

<!-- @code src/ui/components/index.ts#ValidationPanel -->
<!-- @code src/ui/diagnostics.ts#groupDiagnostics -->
<!-- @code src/ui/diagnostics.ts#diagnosticSelection -->

## Validation panel

検証パネルは診断を code ごとにまとめ、各行に記号、severity 名、code、message、対象を出す。
同じ code の診断は先頭 1 件を出し、残りは開閉できる行へ畳む。
severity（すべて、エラー、警告、情報）で絞り込め、status bar の件数から開いたときはその severity で絞り込む。
対象が key / encoder / layer / Mac のキーなら「〜へ」で盤面の layer と選択を移し、パネルを閉じてから盤面へ focus を戻す。
severity は診断の性質だけで決まり、Apply を止める判断は Apply 側の gate に委ねる。
同じパネルの下に参照の整合（Behaviors and references）を置く。

<!-- @code src/ui/components/index.ts#ApplyDialog -->
<!-- @code src/ui/apply-gate.ts#toWriteTarget -->
<!-- @code src/ui/apply-gate.ts#buildApplyGate -->
<!-- @code src/ui/apply-gate.ts#applyBlockedReason -->

## Apply modal steps

Apply は backup、差分確認、確認、書き込み、結果の 5 段階を 1 つの modal の中で順に進める。
開始できるのは Cornix が ready で、接続済みで、この接続で full read を終え、差分が 1 件以上あり、gate に error が無いときだけである。
gate は validation の診断に、実機 definition の digest の不一致と実機 write 未対応の差分を error として足して評価する。

backup の段階では、この接続で読み込んだ実機の状態を `keysync/backups/` と `keysync/backups/latest.vil` へ保存する。
保存できなければ書き込みへ進まず、キャンセルだけを出す。
差分確認では追加・変更・削除の tag、対象、現在と移行後の挙動と raw 式を表で出し、`notationOnly` は件数だけを出して書き込み対象であることを明記する。
確認の段階では warning を診断 id 単位の checkbox で承認させ、承認は `keysync/acknowledgements.json` へ保存する。
承認は根拠の値ごとに記録し、差分が変わると gate の fingerprint により外れる。
書き込みは gate が開き、確認した plan と同じ fingerprint の plan だけで始める。

書き込みの段階は verify 済みの件数、実測の往復回数、各 operation の待機・実行中・verify 済みを出し、残り時間を推定しない。
書き込みを始める前はキャンセルでき、始めた後は「中断」だけを出し、Esc では何もしない。
中断した状態は持ち越さず、full read からやり直させる。
結果は「実機に反映した」とだけ言い、電源を切った後に残るかは確認していないことと、その確かめ方を明示する。
すべての operation の verify を終えたら実機を full read し直し、current と desired が一致した状態へ収束させる。
反映済みの差分を残したままにすると、同じ Apply をもう一度開始できてしまうためである。

<!-- @code src/ui/components/index.ts#CornixDevicePanel -->
<!-- @code src/ui/components/index.ts#MacDevicePanel -->

## Device panel

Cornix の実機パネルは「接続する」「実機から読み込む」「差分を確かめて Apply する」の 3 段階を、終えた段階と次の段階が分かる形で並べる。
接続は機器の選択を開き、許可済みの機器があればそれを取り直す。
接続しただけでは実機を読み込まず、読み込むまで差分は出ない。
読み込み中は往復回数（総数が分かるときは総数も）を出し、読み込んだら時刻と往復回数、実機と workspace の UID と definition の一致を出す。
差分の段階では差分の一覧と gate の error を出し、Apply の入口と開始できない理由を置く。
Apply の入口を押すとパネルを閉じてから Apply の modal を開く。
「backup から復元」は `keysync/backups/latest.vil` を目標状態へ読み込むだけで、実機にも `keymap.yaml` にも書き込まず、通常の差分確認と Apply へ戻す。
Cornix が ready でなければ復元を無効にする。

Mac の実機パネルは「Karabiner へ適用…」の入口と押せない理由、`just mac apply` でも適用できること、適用先、mod-tap の閾値、Karabiner asset の書出を置く。
mod-tap の閾値は Enter か focus を外したときに保存し、50〜1000 の整数でなければ保存せずに欄の下へ理由を出す（ADR 0044）。
保存は `mac-keyboard.<layout>.yaml` までで、Karabiner への反映には適用が要る。

<!-- @code src/ui/components/index.ts#OverviewPanel -->
<!-- @code src/ui/overview-model.ts#buildOverviewModel -->
<!-- @code src/ui/overview-layout.ts#overviewColumns -->

## Overview layer grid

全体マップは layer ごとのカードと、使用中の Tap Dance を 1 つのパネルに並べる。
初期表示は layer 0 と、物理キー・encoder・Tap Dance・Combo の keycode 領域から参照される layer だけとし、参照元の無い layer は checkbox で表示する。
参照ありの判定はこのパネルの表示用集計で、既存の reachability 診断、severity、Apply gate を変更しない。
列数は `overviewColumns` で 3 を上限に、行あたりのカード数が揃うところまで減らす。

各カードは `L番号`、layer 名の入力、到達不能・参照なしの tag、「開く」、物理キー全件の mini 盤面、encoder の割り当て、参照元の一覧を出す。
カードは layer 番号の順に強調色 3 色で塗り、`L番号` と名前を識別子にする。
mini 盤面の倍率はカードの実測幅から 14〜52px で決め、各キーは keycode display の primary を出し、raw keycode は title へ残す。
layer 名は Enter または blur で trim して `keysync/labels.yaml` へ保存し、空文字は名前を削除し、Esc は入力だけを取り消す。
参照元の一覧は押すと参照元の layer を開き、hover と focus の間は参照元の mini キーを枠で強調する。
使用中の Tap Dance は参照数が 1 以上の entry を index 順に、tap / hold / double tap / hold after tap / timeout と使用箇所数を読み取り専用で出す。

SVG / PDF の書出は、盤面で選択中の layer を `keysync/generated/keymap-layer-N.*` へ書き出す。
キー、encoder、Tap Dance の編集は盤面と動作定義へ残し、全体マップでは layer 名だけを編集可能にする。

<!-- @code src/ui/components/index.ts#FilesPanel -->
<!-- @code src/ui/browser-files.ts#pickVilText -->
<!-- @code src/ui/browser-export.ts#parseBrowserVil -->
<!-- @code src/ui/browser-export.ts#serializeBrowserVil -->
<!-- @code src/ui/browser-export.ts#renderBrowserSvg -->
<!-- @code src/ui/browser-export.ts#renderBrowserPdf -->
<!-- @code src/ui/browser-export.ts#generateBrowserKarabiner -->
<!-- @code src/ui/browser-export.ts#generateBrowserKarabinerFromDocument -->

## Browser import / export

ファイルパネルは `.vil` の読込・書出、ディスクからの再読込、利用者ガイドへの外部 link を置く。
Cornix が ready でなければ `.vil` の読込・書出を無効にし、理由を出す。
再読込は workspace が開いていれば使える。

`.vil` 読込はファイル選択後に parse し、現在 workspace の definition binding を維持したまま `keymap.yaml` の desired state へ保存する。
UID や容量が実機と異なる場合は通常の validation / Apply gate で止める。
VIL、SVG、PDF の書出は workspace の Git 管理外である `keysync/generated/` へ保存する。
SVG / PDF は renderer へ選択中の layer を渡し、CLI と同じ座標と表示名の規則を使う。
いずれも実機への write を開始しない。

Karabiner の complex_modifications asset の書出は、Mac 表示中の実機パネルが担う。
保存先は `keysync/generated/karabiner-complex-modifications.json` である。
生成元は編集中の in-memory document であり、ディスクを再読しない（ADR 0025）。
error が 1 件でもあれば書き出さない。
`karabiner.json` へ触るのは CLI の `keysync mac apply` とローカルサーバーの適用 API だけで、Web UI 自身は触らない（ADR 0034）。

<!-- @code src/ui/components/index.ts#BehaviorsPanel -->
<!-- @code src/ui/components/index.ts#CornixReferences -->
<!-- @code src/ui/components/index.ts#MacReferences -->
<!-- @code src/ui/behavior-edit.ts#editTapDanceField -->
<!-- @code src/ui/behavior-edit.ts#editComboField -->
<!-- @code src/ui/behavior-edit.ts#editSettingValue -->

## Behaviors and references

動作定義は Tap Dance、Combo、Settings の tab で、それぞれ使用中の件数を tab に出す。
Tap Dance は全 entry をカードで並べ、使用中の entry は色と「N か所で使用」の tag で示す。
Combo は出力が `KC_NO` の entry を既定で畳む。
Settings は Cornix LP 公式 firmware V1.12 で確認した qsid 辞書の名前で出し、辞書に無い qsid は `qsid N` の raw 表記を残す。
保存形式と validation は常に qsid を正とする。
各値は Enter または blur で Core の編集結果として `keymap.yaml` へ保存し、keycode の欄には表示名を補助表示する。
timeout と設定値は 0〜65535 の整数だけを保存し、範囲外や空欄は保存せず、欄の下と status bar に理由を出す。

Cornix の参照は dynamic entry の usages / unused と layer の unreachable を、診断とは別の情報として検証パネルに出す。
Mac の参照はファイル、物理配列、適用先、`device_if` 相当、layer 数、割り当て数、Karabiner 非対応の件数を出す。
検出した内蔵配列は Browser では出さず、CLI が apply / diff のときに検出すると書く。
表示名の変更は validation、diff 判定、Apply fingerprint へ影響しない。

<!-- @code src/ui/components/index.ts#WorkspaceGate -->
<!-- @code src/ui/components/index.ts#CornixRecovery -->
<!-- @code src/ui/components/index.ts#MacRecovery -->
<!-- @code src/ui/workspace-probe.ts#probeStore -->

## Workspace recovery

workspace を読めた時点で成立する。
`keymap.yaml` の欠落や parse 失敗は Cornix 対象へ閉じ、Mac の編集を止めない。
Cornix を選んだときだけ、盤面の位置に keymap 欠落、旧 digest binding、改名前の管理ディレクトリ、その他の読み込み失敗を分けて復旧操作を出す。
keymap 欠落からの初期化は、接続が無ければ機器の選択を開いてから full read し、workspace ファイルを作るだけで実機へ write しない。
Mac の配列ファイルが無い、または読めないときも、その配列を選んだときだけ盤面の位置に復旧を出す。
復旧の間は編集パネルに編集できない理由を出し、picker を出さない。
workspace 自体を読めなかったときは、入口に理由と再読込を出す。
