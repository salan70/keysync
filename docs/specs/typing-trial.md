# 打鍵テスト

Mac の mod-tap の閾値（`tapping_term_ms`）を、実際に打った結果で調整するための採点の仕様です。
判断は ADR 0045 にあり、画面は `ui.md` の「Typing panel」にあります。

ブラウザが受け取るのは Karabiner が処理した後の入力です。
したがって誤爆（`⌥A` など）、文字の脱落、入れ替わりをそのまま観測できます。
押下時間は観測できないため扱いません。

<!-- @code src/core/typing-trial/types.ts#ModifierSet -->
<!-- @code src/core/typing-trial/types.ts#TypedEvent -->
<!-- @code src/core/typing-trial/types.ts#TrialToken -->
<!-- @code src/core/typing-trial/types.ts#TypingTask -->

## Typing trial types

`TypedEvent` は `keydown` 1 回を写した値で、DOM の `KeyboardEvent` には依存しません。
修飾キーは左右を区別しません。
ブラウザの `KeyboardEvent` が修飾の左右を持たないためです。

採点の単位は `TrialToken` です。
修飾キーの無い文字（Shift による大文字を含む）は `char`、meta / ctrl / alt のどれかを伴う押下は `chord` です。
`chord` の key は `code` から取ります（`KeyA` → `a`）。
Option で文字が化けても（`å`）、配列が変わっても、同じ chord として比べられます。

課題は `text`（文を打つ）と `hold`（mod-tap を押し続けて chord を出す）の 2 種類です。
`hold` は位置（Karabiner の `key_code` 名）だけを持ちます。
キャップの刻印は配列に依存する UI の語彙なので、表示名は UI 層が作ります。

<!-- @code src/core/typing-trial/tasks.ts#ROLL_TASKS -->
<!-- @code src/core/typing-trial/tasks.ts#customTask -->

## Roll tasks

既定のロール集は、前のキーを離す前に次のキーを押しやすい並びを集めたものです。
ローマ字の子音 → 母音（`ka` `ha` `ja` `sa` `da` `ga` の行）、英単語、ホームロウ同士の隣接ペア（`df` `jk` など）を含みます。
自由入力の課題は、入力した文の 1 文字ずつを期待にします。

<!-- @code src/core/typing-trial/tasks.ts#holdTasksFor -->
<!-- @code src/core/typing-trial/tasks.ts#HOLD_REPEAT -->

## holdTasksFor

layer 0 の mod-tap ごとに hold 課題を 1 つ作ります。
期待は同じ chord の `HOLD_REPEAT`（3）回です。
1 回では偶然と区別できないためです。

押し続けるキーの反対の手から、layer 0 に割り当ての無い文字キーを 1 つ選びます。
割り当てがあると、押したキー自体が変換されて期待が定まらないためです。
手の左右は物理盤面（`macPhysicalLayout`）の中心で分けます。
候補は左手が `e r x c v`、右手が `u i o p y` の順です。
⌘Q・⌘W・⌘T・⌘N・⌘H・⌘M はブラウザや OS が先に取り、ページで止められないため候補に入れません。
候補がすべて割り当て済みの mod-tap は課題にしません。

修飾が Shift だけの mod-tap は、chord ではなく大文字の文字を期待します。
ブラウザが受け取る形に合わせるためです。

<!-- @code src/core/typing-trial/grade.ts#TrialEntry -->
<!-- @code src/core/typing-trial/grade.ts#TrialSummary -->
<!-- @code src/core/typing-trial/grade.ts#TrialGrade -->
<!-- @code src/core/typing-trial/grade.ts#tokenizeTypedEvents -->
<!-- @code src/core/typing-trial/grade.ts#sameToken -->
<!-- @code src/core/typing-trial/grade.ts#gradeTypingTrial -->

## gradeTypingTrial

打鍵列を token 列へ変えてから、期待の token 列と最小コストで整列します。

token 列への変換規則です。

- 修飾キー単独の押下（Shift、Meta など）は捨てます
- meta / ctrl / alt のどれかを伴う押下は chord にします
- Backspace は訂正として数えるだけで、出力からは消しません。訂正すると誤爆が見えなくなるためです
- それ以外は、`key` が 1 文字の押下だけを文字にします。Enter や矢印は捨てます

整列の操作とコストです。
同じコストの経路が複数あるときは、この表の上の操作を優先します。

| 操作       | 期待         | 出力       | コスト | 分類      |
| ---------- | ------------ | ---------- | ------ | --------- |
| 一致       | 1 個         | 1 個       | 0      | `ok`      |
| 組の誤爆   | 文字 `k` `a` | chord `⌥A` | 1      | `misfire` |
| 入れ替わり | `a` `b`      | `b` `a`    | 1      | `swapped` |
| 置換       | 1 個         | 1 個       | 1      | 下記      |
| 脱落       | 1 個         | なし       | 1      | `dropped` |
| 余分       | なし         | 1 個       | 1      | `extra`   |

置換は、期待が文字で出力が chord なら `misfire`、それ以外は `wrong` です。
組の誤爆は、前の文字が修飾キーになり次の文字と chord になった形です。
1 つの出来事として数えるため、専用の操作にしています。

末尾に続く脱落は数えず、`unfinished` に件数を入れます。
打ち終える前に採点しただけで、Karabiner の取りこぼしではないためです。
`expected` は `unfinished` を除いた数です。

誤爆は 2 文字の組（`ka` など）で集計します。
組で整列できなかった単独の誤爆は、直前の期待文字と組にします。

IME の変換中の押下が 1 つでも混ざったら採点せず、`ime` を返します。

<!-- @code src/core/typing-trial/history.ts#TrialRecord -->
<!-- @code src/core/typing-trial/history.ts#TrialRow -->
<!-- @code src/core/typing-trial/history.ts#summarizeTrials -->

## summarizeTrials

試行を閾値ごとに合計します。
閾値は、打った時点で Karabiner に効いていると確かめた値です。
確かめていない試行は「未確認」の 1 行にまとめます。

文章課題と hold 課題は分けて数えます。
閾値を上げると文章課題の誤爆は減り、hold 課題の成功も減ります。
両方を並べて見られるようにするためです。
行は閾値の昇順で、未確認は最後に置きます。
