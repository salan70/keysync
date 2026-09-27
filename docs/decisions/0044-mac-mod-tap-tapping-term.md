# Mac keyboardのmod-tapを閾値でtapとholdに分ける

状態: 採用

2026-09-27に、MacBook内蔵キーボードのホームロウmodでロール打鍵が誤爆する問題を受けて決めた。

## 背景

ADR 0022はmod-tapを`to: [{ key_code: <modifier>, lazy: true }]` + `to_if_alone`へ落とした。
この形では、押している間に別のキーを押すと、押していた時間に関係なくmodifierが掛かる。
tapになるのは、他のキーに触れずに離した場合だけである。

速い打鍵では前のキーを離す前に次のキーを押す。
ローマ字入力の`ka`（k↓ a↓ k↑）は⌥A、`ha`は⌃A、`ja`は⌘Aになった。
ホームロウmod同士が重なると（d→f）、先のキーの文字が消えた。
利用者はゆっくり打つことを強いられていた。

Karabinerの公式ドキュメントで確認した事実。

- Fact: `to_if_held_down`は`from`を`basic.to_if_held_down_threshold_milliseconds`押し続けると送られる
- Fact: `to_delayed_action`のtimerは`from`のkey downで始まり、`basic.to_delayed_action_delay_milliseconds`の前に別のキーが押されると`to_if_canceled`を送る
- Fact: `to_if_alone`は`basic.to_if_alone_timeout_milliseconds`（既定1000ms）より長く押すと送られない
- Fact: `to_if_alone`または`to_if_held_down`のイベントに`halt: true`を付けると、後続の`to_after_key_up`と`to_delayed_action`を打ち切る
- Fact: 3つの閾値はmanipulatorの`parameters`で個別に上書きできる

## 選択肢

1. 現行の形のまま、`to_if_alone`の閾値だけを短くする
2. `to_if_held_down`・`to_delayed_action`・`to_if_alone`を同じ閾値で組み合わせる
3. `simultaneous`などで押下順を細かく判定する

閾値の置き場所について。

1. 生成器の定数にする
2. `mac-keyboard.<layout>.yaml`に全mod-tap共通の値を持ち、Web UIから編集する
3. キーごとに持つ

## 決定

形は案2、閾値の置き場所は案2を採る。

- mod-tapは次の形にする。`to`は持たない

  ```json
  {
    "to_if_alone": [{ "key_code": "<tap>", "halt": true }],
    "to_if_held_down": [<modifier>],
    "to_delayed_action": { "to_if_canceled": [{ "key_code": "<tap>" }] },
    "parameters": {
      "basic.to_if_alone_timeout_milliseconds": <T>,
      "basic.to_if_held_down_threshold_milliseconds": <T>,
      "basic.to_delayed_action_delay_milliseconds": <T>
    }
  }
  ```

- 3つの閾値は同じ値`T`にそろえる
- 複合modifierのhold側は、先頭を`key_code`、残りを`modifiers`に置く（ADR 0043の規則を`to_if_held_down`へ移す）
- `T`は`mac-keyboard.<layout>.yaml`の`tapping_term_ms`に置く。全mod-tapで共通の1値で、範囲は50〜1000の整数、省略時は200
- serializerは`tapping_term_ms`を常に書き出す
- Web UIのMacの実機パネルで`tapping_term_ms`を編集できる。反映はこれまでどおりKarabinerへの適用で行う
- `LT n(kc)`（layer-tap）は変えない

ADR 0022の「mod-tap → `to: [{ key_code: <modifier>, lazy: true }]` + `to_if_alone`」と、ADR 0043の「複合modifierのmod-tapに`lazy`を付ける」を本ADRが上書きする。

## 理由

- **案1では直らない。** 誤爆の原因は時間ではなく、押している間の他キーでmodifierが確定することにある
- **案2はQMKのtapping termに近い。** 閾値より前に次のキーを押すか離せばtap、閾値まで押し続ければholdになる。ロール打鍵はtapになる
- **3つの閾値をそろえる。** delayed actionだけ長いと、holdが確定したあとに押したキーの前へ`to_if_canceled`がtap側の文字を送る。aloneだけ長いと、holdして離したときに文字も出る
- **tap側に`halt`を付ける。** 付けないと、tapして離したあと閾値の前に次のキーを押したとき、`to_if_canceled`が同じ文字をもう一度送る
- **案3は要らない。** 案2で要件を満たせ、manipulatorも1キー1本のまま保てる
- **閾値をファイルに置く。** 適切な値は打鍵の速さに依存し、実機で合わせる必要がある。Web UIから変えられないと、調整のたびにyamlを手で直すことになる
- **キーごとには持たない。** 今は全キー共通で困る事例が無い

## 影響

- ショートカットを使うには、閾値まで押し続けてから次のキーを押す必要がある。これまでは即座に押せた
- holdの閾値を超えてから何も押さずに離すと、何も入力されない
- `tapping_term_ms`の無い既存の`mac-keyboard.*.yaml`は、次に保存したときに`tapping_term_ms: 200`の行が加わる
- 既存のKarabiner設定との差分は、全mod-tapのmanipulatorの変更として出る
- Open Question: 割り込んだキーより前に`to_if_canceled`の文字が出るか（文字順が入れ替わらないか）は、Karabiner 15.3.0の実機でまだ確かめていない。適用後に確かめ、結果をこのADRへ追記する
