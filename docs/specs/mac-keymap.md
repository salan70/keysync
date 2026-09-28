# Mac keyboard

MacBook内蔵キーボードのdesired stateと、kanataへの生成・適用の仕様です。
判断はADR 0049（kanataをengineとする）、ADR 0022（desired stateの持ち方）、ADR 0023（keycode構文層）にあります。

Cornix LP向けの`keymap.yaml`とは**別のdevice class**です。Apple製キーボードには
firmwareのkeymapが無く、matrix・keyboard definition・実機申告の容量・WebHIDという
`VilDocument`側の前提が1つも成立しません。したがって`VilDocument`へ寄せず、
`src/core/keycode/table.ts`の`createKeycodeTable`も使いません。

## 位置づけ

```text
mac-keyboard.<layout>.yaml   desired state（Git管理、workspace直下。配列ごと）
  ↓ parseMacKeymapYaml
MacKeymapDocument            layer番号 → (Karabinerのkey_code名 → QMK表記)
  ↓ generateKanataConfig
kanata.kbd                   kanataの設定（~/Library/Application Support/keysync/）
```

位置の識別はKarabinerの`key_code`名です（ADR 0022で決めた語彙を、engineを替えた後も使います）。
matrixのrow / colを持ちません。
**割り当ての無いキーは書きません**。layer 0では素通し、layer 1以上では割り当てなし（何も出さない）になります（ADR 0050）。
layer番号も`key_code`名も疎で、連続している必要はありません。

<!-- @code src/core/mac-keymap/types.ts#MacKeymapDocument -->
<!-- @code src/core/mac-keymap/types.ts#MacDeviceIdentifier -->

## MacKeymapDocument

desired stateの内容です。schema識別子は`keysync/mac-keymap@1`で、
`keymap.yaml`の`keysync/keymap@1`とは別系統です。

`layout`は対象の物理配列（`ansi` / `jis`）です。fromキーの妥当性が物理配列に依存するため
（US配列に`japanese_kana`は無い）、keymapの前提条件として宣言します（ADR 0024）。YAMLでは
省略でき、省略時は`jis`です。型の上では必須で、既定値を埋めるのはparseだけの責務です。

`devices`はこの設定を適用するデバイスです。設定の単位は「内蔵キーボード」ではなく
**物理配列**で、同じ配列の内蔵キーボードと外付けキーボードへ同じ設定を効かせます
（ADR 0026）。内蔵は`{ builtIn: true }`、外付けは`{ vendorId, productId }`です。
kanataはmacOSのデバイスを名前でしか指せないため、外付けは生成器がerrorにします（ADR 0049）。`layout`と同じく
YAMLでは省略でき、省略時は内蔵キーボードだけ（`DEFAULT_MAC_DEVICES`）です。

`tappingTermMs`はmod-tapのtapとholdを分ける閾値（ms）です。全mod-tapで共通の1値で、
50〜1000の整数です（ADR 0044）。YAMLでは`tapping_term_ms`と書き、省略時は200
（`DEFAULT_MAC_TAPPING_TERM_MS`）です。

`flowTapTermMs`はFlow Tapの閾値（ms）です。直前の文字キーからこれより短い間隔で押した
文字のmod-tapは、押している長さに関係なくtapになります。0〜1000の整数で、0は無効です
（ADR 0047）。YAMLでは`flow_tap_term_ms`と書き、省略時は0（`DEFAULT_MAC_FLOW_TAP_TERM_MS`）です。

<!-- @code src/core/mac-keymap/serialize.ts#serializeMacKeymapYaml -->

## serializeMacKeymapYaml

`mac-keyboard.<layout>.yaml`のテキストを組み立てます。

```text
schema: keysync/mac-keymap@1
layout: jis
devices:
  - { built_in: true }
  - { vendor_id: 1452, product_id: 630 }
tapping_term_ms: 200
flow_tap_term_ms: 0
layers:
  0:
    "caps_lock": "LCTL_T(KC_ESC)"
    "japanese_kana": "LT1(KC_LANG1)"
  1:
    "h": "KC_LEFT"
```

並べ方は`keysync/labels.yaml`と同じく、section見出しの下へ`key: "value"`を1行ずつ置く形です。
`keymap.yaml`のserializerは物理配列の格子をdiffのhunkへ残すためにrowをflow sequenceで
並べますが（ADR 0009）、こちらは疎なmapなので格子がありません。

並び順はlayer昇順・`key_code`名昇順で固定します。生成器が行を並べる規則と
同じにして、手で並べ替えてもdiffが動かないようにします。

`layout`行、`devices`、`tapping_term_ms`行、`flow_tap_term_ms`行は省略時の既定があっても
**常に**書き出します。正規形は明示です（ADR 0024・0026・0044・0047）。`devices`の各項目は1行のflow mappingで置きます。疎なmapを1行ずつ
置くこのファイルの方針に合わせたもので、block mappingへは展開しません。

<!-- @code src/core/mac-keymap/parse.ts#parseMacKeymapYaml -->

## parseMacKeymapYaml

**汎用のYAML parserではありません。** `serializeMacKeymapYaml`が出す部分集合だけを受け付け、
それ以外は`MacKeymapParseError`で落とします。desired stateを黙って読み違えるより、
読めないことを大きな声で言うほうが安全なためです（ADR 0009と同じ理由）。

受け付ける形はインデントの深さで決まります。2がlayer番号、4が割り当てです。
値は`JSON.stringify` / `JSON.parse`で引用します。schemaが一致しない、layer番号が重複する、
同じlayerで`key_code`が重複する場合はすべて落とします。
ADR 0049より前の`profile`行（Karabinerのprofile名）は読み捨て、書き出しません。
`layout`は省略なら`jis`、`ansi` / `jis`以外の値なら落とします（ADR 0024）。
`devices`が受け付けるのは`- { built_in: true }`と`- { vendor_id: N, product_id: N }`を
2スペース字下げした2形だけで、省略なら内蔵キーボードだけ、2回書けば落とします（ADR 0026）。
`tapping_term_ms`は省略なら200、50〜1000の整数でなければ落とします（ADR 0044）。
`flow_tap_term_ms`は省略なら0、0〜1000の整数でなければ落とします（ADR 0047）。

schemaは`keysync/mac-keymap@1`のほか、改名前の`cornix-bonsai/mac-keymap@1`も受け付けます（ADR 0036）。
書き出すのは常に`keysync/mac-keymap@1`で、開いただけではファイルを書き換えません。

`parse(serialize(x))`が`x`と等しくなることを`fixtures/mac-keyboard/desired.yaml`で検証します。

<!-- @code src/core/mac-keymap/key-codes.ts#karabinerKeyCode -->
<!-- @code src/core/mac-keymap/key-codes.ts#karabinerKeyEvent -->
<!-- @code src/core/mac-keymap/key-codes.ts#passthroughKeycode -->

## karabinerKeyCode

QMK表記を位置の語彙（Karabinerの`key_code`名）へ写します。表のkeyは`canonicalKeycode`が返す長い表記で持ち、
引く前に必ず畳みます。`classifyKeycode`の語彙が長い表記を正としているためです
（ADR 0001・0010）。

**この表は閉じています。** 載っていない表記は`mac-keymap/unsupported-keycode`（error）に
なります。Vial側の`reference/unknown-keycode`がwarningなのは実機が解釈するからで、
Macは生成器が落とせなければ機能そのものが無くなるためseverityが違います（ADR 0023）。

生成器がキーを組むときは`karabinerKeyEvent`を使います。表に無い`KC_EXLM`のような
shift済みkeycodeを、baseの`key_code`に`left_shift`を付けたキーへ写します。
`!`単体のキーが無いためです（ADR 0043）。
修飾の`modifiers`は`KARABINER_MODIFIERS`がwrapper名から引き、複合modifierはQMKの定義どおりに展開します。
逆向きの`passthroughKeycode`は、割り当ての無い位置が素通しで送るQMK表記を返します。
UIが素通しのキーへHold や動作を足すとき、Tapの初期値に使います。

位置として書ける`key_code`名は`KARABINER_POSITIONS`です。表の値に、QMK側へ対応の無い
MacBookの`fn`を足したものです。

語彙として正当でも、宣言した物理配列に存在しない位置は`LAYOUT_MISSING_POSITIONS`
（`KARABINER_POSITIONS`の部分集合）で判定し、`mac-keymap/position-not-on-layout`（warning）に
します。`ansi`側の集合はFact（`japanese_kana` / `japanese_eisuu`、実機確認）とInference
（`international*` / `non_us_*`、HID usageの定義上ANSIに対応キーが無い）を区別して持ちます。
`jis`側は`grave_accent_and_tilde` / `right_option`で、MacBookのJIS盤面に無いことからの
Inferenceです（ADR 0024・0025）。

**この集合は盤面の差を覆っていなければなりません。** 片方の盤面にあってもう片方に無い
位置が漏れると、その割り当てが無診断で静かに失われます。`physical-layout.test.ts`が
両方向で検証します。両方の盤面に無い位置（`keypad_*` / `f13`〜`f24` / メディアキーなど）は
入れません。物理キーが`fn`の状態で別のusageを送るため、盤面に無いことが「発火しない」の
根拠になりません。

<!-- @code src/core/mac-keymap/kanata/key-names.ts#kanataPositionName -->
<!-- @code src/core/mac-keymap/kanata/key-names.ts#kanataKeyName -->

## kanataKeyName

位置の語彙（Karabinerの`key_code`名）をkanataのキー名へ写します。位置は`kanataPositionName`、
QMK表記のkeycodeは`kanataKeyName`で引きます。keycodeは`karabinerKeyEvent`で位置の語彙へ
畳んでから引くので、shift済みkeycodeは`S-1`のようなoutput chordになります（ADR 0049）。

キー名はkanataの`parser/src/keys/mod.rs`のうちmacOSで有効な名前に従います。記号は1文字の
別名がありますが、S式の区切りと紛れないよう英字の名前（`scln`、`apos`など）を使います。

**この表も閉じています。** macOSのkanataに対応する名前が無い位置（`international3`、
`print_screen`、`help`、`mission_control`など）は載せず、使えば`mac-keymap/unsupported-position`
（error）になります。表の全キーをkanataが読めることは、kanataが入っている開発機のtestで
`kanata --check`を通して確かめます。

<!-- @code src/core/mac-keymap/edit.ts#setMacAssignment -->
<!-- @code src/core/mac-keymap/edit.ts#clearMacAssignment -->
<!-- @code src/core/mac-keymap/edit.ts#addMacLayer -->
<!-- @code src/core/mac-keymap/edit.ts#addMacDevice -->
<!-- @code src/core/mac-keymap/edit.ts#setMacTappingTerm -->
<!-- @code src/core/mac-keymap/edit.ts#setMacFlowTapTerm -->

## Mac edit

意味単位の編集操作です。`semantic-model.md`の`setKeyAssignment`と同じ思想で、keycodeは
正規化せず渡された表記のまま置き、妥当性の判定は`validateMacKeymap`に委ねます（ADR 0025）。
すべてcopy-on-writeの純関数で、元のdocumentを変更しません。

Vial側と違いlayersは疎なmapなので「範囲外」という概念が無く、`setMacAssignment`は
無いlayerへの書き込みでlayerを作ります。`clearMacAssignment`は割り当てを外し、
layer 0では素通し、layer 1以上では割り当てなしへ戻します。layer 0では`KC_NO`（イベントを捨てる）と削除（素通し）は別セマンティクスです（ADR 0022）。
空になったlayerは残します。「割り当てを外したらlayerが消える」という驚きを避けるためです。

`addMacDevice`は適用先デバイスを末尾へ足します。既にあるデバイスは足しません。順序は
追加順のまま保ちます。並べ替えるとdiffが動くためです。

`setMacTappingTerm`はmod-tapの閾値を差し替えます。50〜1000の整数でなければ
`MacKeymapEditError`で拒みます。同じ値なら元のdocumentをそのまま返します（ADR 0044）。
`setMacFlowTapTerm`はFlow Tapの閾値を同じ規則で差し替えます。範囲は0〜1000で、0は無効です（ADR 0047）。

<!-- @code src/core/mac-keymap/physical-layout.ts#MacPhysicalKey -->
<!-- @code src/core/mac-keymap/physical-layout.ts#macPhysicalLayout -->

## Physical layout

Browser UIの盤面描画用に、MacBook内蔵キーボードの物理盤面を`macPhysicalLayout(layout)`が
返します。definition（KLE）由来ではない手書きデータで、Coreが所有します（ADR 0025）。

`MacPhysicalKey`の位置識別子はKarabinerの`key_code`名（`fn`含む）で、matrixの
row / colは持ちません。rotationは常に0で、`src/render/geometry.ts`の`KeyShape`を
構造的部分型として満たすため、盤面描画はCornix側と同じgeometryを通ります。

手書きデータの正しさはtestの不変条件で固定します: 全キーが`KARABINER_POSITIONS`に
属する・重複なし・`LAYOUT_MISSING_POSITIONS`のキーを置かない・**片方の盤面にしかない位置が
もう片方の`LAYOUT_MISSING_POSITIONS`に入っている**・矩形が重ならない・
fixtureの全from位置を被覆する。座標と幅はApple公開の製品画像からの読み取り
（Inference）です。Touch ID / 電源は`key_code`が無いため盤面に置かず、JISの縦長Returnは
矩形で近似します。

<!-- @code src/core/mac-keymap/kanata/generate.ts#generateKanataConfig -->

## generateKanataConfig

desired stateからkanataの設定テキストを組み立てます。展開規則はADR 0049、構文層の出どころは
ADR 0023です。`classifyKeycode`が返す`KeycodeLexeme`から直接写します。判定はCornix LPの
Vial settings（Permissive Hold、Chordal Hold、Flow Tap）に合わせます。

| `KeycodeLexeme`             | kanata                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `transparent`               | layer 0は書かない。layer 1以上は`_`                                                           |
| `none`                      | `XX`                                                                                          |
| `basic`                     | キー名。shift済みkeycodeは`S-1`のようなoutput chord                                           |
| `modified`                  | output chord（`C-a`、`C-S-tab`、`M-lbrc`など）                                                |
| `layerSwitch` / `momentary` | `(layer-while-held l<n>)`                                                                     |
| `layerSwitch` / `layerTap`  | `(tap-hold-opposite-hand-release $tapping-term <tap> (layer-while-held l<n>) (timeout hold))` |
| `modTap`（holdがShiftだけ） | `(tap-hold-release 0 $tapping-term <tap> <shift>)`                                            |
| `modTap`（それ以外）        | `(tap-hold-opposite-hand-release $tapping-term <tap> <hold> (timeout hold))`                  |
| それ以外（`TG`を含む）      | error diagnostic                                                                              |

設定の組み立ての規則は以下です。

- `defcfg`で`process-unmapped-keys yes`にし、`macos-dev-names-include`で内蔵キーボード
  （`"Apple Internal Keyboard / Trackpad"`）だけを掴みます。Cornix LPなどの外付けには触りません
- layerは番号の昇順に`deflayermap`で並べます。layer 0は`base`、それ以外は`l<n>`です。
  kanataは最初のlayerを起動時のlayerにします。layer 1以上は最後に`___ XX`を置き、書かれて
  いないキーを割り当てなしにします（ADR 0050）。`MO` / `LT`が指すlayerは、割り当てが無くても空のlayerを出します
- **書かないのはlayer 0の`KC_TRNS`だけです。** layer 1以上はlayer 0と同値のキーも書きます
- 閾値は`(defvar tapping-term <tappingTermMs>)`に1回だけ書き、tap-holdは`$tapping-term`で参照します
- home mod（Shift以外のmod-tap）は`tap-hold-opposite-hand-release`です。同じ手のキーを押せばtap
  （Chordal Hold）、反対の手のキーを押して離せば閾値の前でもhold（Permissive Hold）、閾値を
  過ぎればhold（`(timeout hold)`、QMKと同じ）です。手の割り当ては生成器の固定表を`defhands`に
  書きます。Cornixで同じ役割のキーと同じ手にし、spacebarと英数は左、かなは右です
- holdがShiftだけのmod-tapは`tap-hold-release`で、手を問わないPermissive Holdです。MacのShiftは
  小指で押し、同じ手の文字とも組むため、Chordal Holdを掛けません
- 複合modifier（`SGUI_T`など）のholdは`(multi lsft lmet)`のように並べます（ADR 0043）
- `flowTapTermMs`が0より大きいとき、`defcfg`に`tap-hold-require-prior-idle <flowTapTermMs>`を
  書きます（Flow Tap、ADR 0047）。tap側が文字キー（`a`〜`z`、`comma`、`period`、`semicolon`、
  `slash`、`spacebar`で修飾なし）でないtap-holdには`(require-prior-idle 0)`を付けて外します
- 外付けの`{ vendorId, productId }`はkanataが指せないので、`mac-keymap/unsupported-device`（error）にします
- 位置の語彙に無いキーは書かずに飛ばします。`validateMacKeymap`の`unknown-position`が報告するためです

`key_code`名の昇順で並べます。生成物が入力の書き順に依存しないようにするためです。

<!-- @code src/core/mac-keymap/kanata/generate.ts#macKeycodeSupport -->

## macKeycodeSupport

keycode 1個をkanataへ落とせるかを返します。落とせない場合は診断のcodeとmessageを持ちます。

**判定を書き写しません。** 実際のloweringを1キーのprobeで走らせ、error診断が出たかどうかで
決めます。「落とせるか」の正は生成器の閉じたswitchと各wrapperの表現可能性で、
判定を別に持つと必ず乖離するためです（ADR 0025）。Browser UIがkeycode pickerのcellを
無効化するのにこの関数を使っても、定義元は1つのまま保たれます。

位置とlayerに依存しない判定だけを返します。書かれていないlayerを指す`MO(n)`のように
document全体を見ないと決まらないものは`validateMacKeymap`の担当です。

<!-- @code src/core/mac-keymap/validate.ts#validateMacKeymap -->

## validateMacKeymap

desired stateの検証の入口です。`validation/validate.ts`の`validateKeymap`は`VilDocument`と
`KeyboardDefinition`を前提にするため使えません。合成の入口をMac側に別途置きます（ADR 0022）。

severityの判定規則はADR 0010のままです。kanataへ落とせず**機能そのものが無くなる**
ものはerror、割り当てが1件単位で静かに失われるものはwarning、情報が保持されていて判断を
ユーザーへ委ねられるものはinformationにします（ADR 0024）。

| code                                     | severity    | 事実                                             |
| ---------------------------------------- | ----------- | ------------------------------------------------ |
| `mac-keymap/no-target-device`            | error       | `devices`が空。どのキーボードにも適用されない    |
| `mac-keymap/unknown-position`            | error       | 位置の語彙（`KARABINER_POSITIONS`）に無い位置    |
| `mac-keymap/unsupported-position`        | error       | kanataに対応するキー名が無い位置                 |
| `mac-keymap/unsupported-device`          | error       | kanataが指せない外付けデバイス                   |
| `mac-keymap/unsupported-keycode`         | error       | 対応するキーが無い、または落とせない構文（`TG`） |
| `mac-keymap/unsupported-mod-tap`         | error       | mod-tapのmodifierかtap側を落とせない             |
| `mac-keymap/unsupported-layer-tap-inner` | error       | `LT`のtap側を落とせない                          |
| `mac-keymap/position-not-on-layout`      | warning     | 宣言した配列に無いfromキー。決して発火しない     |
| `mac-keymap/unknown-layer`               | warning     | 書かれていないlayerを指す`MO` / `LT`             |
| `mac-keymap/unreachable-layer`           | information | layer 0から辿り着くkeycodeが無い                 |

到達性は`analyzeLayerGraph`を共有します。Vial側の`reachability/trapped-layer`は
見ません。対応するlayer操作は押している間だけ効く`MO` / `LT`で、離せば必ず戻るためです。

<!-- @code src/kanata/node.ts#KanataHost -->
<!-- @code src/kanata/node.ts#createKanataHost -->

## KanataHost

kanataの呼び出し口です。`kanata --check`、常駐しているkanataへのReload、TCP serverへの
到達確認、実行ファイルの探索の4つを持ちます。

interfaceにしているのは**testから差し替えるため**です。CIのmacOS runnerでkanataは動かせず、
実物を通すと開発機でtestを回しただけで常駐しているkanataがreloadされます。

kanataはPATH、`/opt/homebrew/bin/kanata`、`/usr/local/bin/kanata`の順に探します。`just ui`は
nixのdevShellから起動するため、PATHにHomebrewが無いことがあります。見つからなければ
`check`は`undefined`を返し、呼び出し側は「kanata不在」として扱います。

Reloadは`127.0.0.1:5179`のTCP serverへ`{"Reload":{"wait":true}}`を1行で送り、`ReloadResult`を
待ちます。kanataは1行1 JSONで応答し、結果の前にlayerの変化などの通知が混ざることがあるため、
`ReloadResult`か`Error`が来るまで読み進めます。接続を拒まれたら`not-running`です。

<!-- @code src/kanata/service.ts#kanataServicePlist -->

## kanataServicePlist

kanataを常駐させるlaunchdのplist（label `dev.keysync.kanata`）です。`kanata --cfg <設定>
--port 127.0.0.1:5179 --no-wait`を`RunAtLoad`と`KeepAlive`で動かし、出力を
`/var/log/keysync-kanata.log`へ書きます。`--no-wait`は、エラーで止まるときにEnterの入力を
待たないようにします（launchdには端末がありません）。

<!-- @code src/kanata/service.ts#ServiceHost -->
<!-- @code src/kanata/service.ts#createServiceHost -->

## ServiceHost

launchdとsudoの呼び出し口です。plistが置かれているかの確認、`sudo install`での配置、
`sudo launchctl bootstrap system`での登録を持ちます。登録済みなら先に`bootout`します。

kanataは内蔵キーボードを掴み、Karabinerの仮想キーボードのdaemonへ出力するためrootで動きます。
KeySyncはパスワードを扱わず、`sudo`を子プロセスとして起動して端末の認証へ任せます
（ADR 0042と同じ）。rootが要るのはこの登録1回だけで、以後の適用はReloadで行います。

<!-- @code src/karabiner/node.ts#readKarabinerConfig -->

## readKarabinerConfig

`karabiner.json`をJSONとして読みます。ファイルが無ければ`undefined`（Karabiner不在）です。
KeySyncは`karabiner.json`へ書き込みません。Karabiner-Elementsはkanataが使うドライバの
提供元として入れたままにし、ここで読むのは内蔵キーボードを掴んでいないかを確かめるためだけです。

<!-- @code src/mac/keyboard-type.ts#detectBuiltInLayout -->

## detectBuiltInLayout

実行中のMacの内蔵キーボードの物理配列をOSへ問い合わせます。判定できなければ`undefined`です。

正はCarbonの`KBGetLayoutType(LMGetKbdType())`で、FourCharCodeで`'ANSI'` / `'ISO '` / `'JIS '`を
返します。macOS同梱の`osascript -l JavaScript`からObjC bridgeで呼ぶため、追加依存はありません。

他の経路は使いません。`karabiner_grabber_devices.json`にはANSI / JISを示すfieldがなく
（ADR 0024）、`ioreg`の`alt_handler_id`は番号から配列への表を自前で持つ必要があって乖離します。

**検出は任意の追加情報です。** 取れないことを理由に処理を止めず、呼び出し側は
`--layout ansi|jis`の明示指定へ落とします（ADR 0027）。
Web UIはこの関数を直接呼びません。
ローカルサーバーがこの関数で検出した配列をWeb UIへ伝え、適用できる編集対象を決めます（ADR 0034）。

<!-- @code src/mac/apply-service.ts#planMacApplyAt -->
<!-- @code src/mac/apply-service.ts#applyMacPlan -->
<!-- @code src/mac/apply-service.ts#writeAndCheck -->

## 適用の境界

`src/core/mac-keymap/`はfilesystemに触りません。kanataの設定ファイルのread / backup / writeは
`src/mac/apply-service.ts`が、kanataの呼び出しは`src/kanata/node.ts`が担います。設定ファイル
`~/Library/Application Support/keysync/kanata.kbd`は**workspaceの外**にあり、
`NodeWorkspaceStore`はpathを`root`からの相対で解決するため使えません。

KeySyncはこのファイル全体を所有します。kanataは設定ファイルを書き戻さないので、diffとverifyは
テキストで行います（ADR 0049、ADR 0042のkeydと同じ）。

適用の手順は`src/mac/apply-service.ts`が持ち、CLIの`keysync mac apply`とローカルサーバーの
適用API（`local-server.md`）が同じ手順を通ります。`planMacApplyAt`が計画と生成・checkまで、
`applyMacPlan`がbackupからreloadまでを行います。fingerprintの照合とcheckの判定は呼び出し側が
その間で行います。

```text
desired stateを読む
→ kanataの設定ファイルとkarabiner.jsonを読む
→ validate（errorがあればここで止める。keysync/は作らない）
→ keysync/generated/kanata.kbdへ書いてkanata --check（落ちたら設定ファイルへ触らない）
→ テキストdiffとfingerprintを出す
→ 人間が同じfingerprintを渡す
→ backup（置き換える前のファイルがあるときだけ）
→ temp + renameで置き換え
→ 読み直してverify
→ 常駐しているkanataへReload
```

**checkは書き込み前のゲート**です。kanataが入っていなければcheckは`undefined`になり、CLIの
`--confirm`とローカルサーバーの適用APIはここで止めます。

Reloadが失敗しても、書き込みは巻き戻しません。巻き戻しはもう一度の書き込みで、新しい失敗の
原因を増やします。kanataが常駐していなければReloadは`not-running`で、ファイルは次にkanataが
起動したときに読まれます。CLIは`keysync mac service install`での登録を案内します。

backupは読んだテキストをそのまま`keysync/backups/kanata-<時刻>.kbd`へ置きます。

書き込みは同じディレクトリのtempへ書いてから`rename`します。途中まで書けたファイルをkanataに
見せないためです。`rename`は同じfilesystemでなければatomicにならないので、tempを置き換え先と
同じディレクトリに作ります。親ディレクトリが無ければ作ります。

<!-- @code src/core/mac-keymap/apply.ts#planMacApply -->
<!-- @code src/core/mac-keymap/apply.ts#verifyMacApply -->
<!-- @code src/core/mac-keymap/apply.ts#diffKanataText -->
<!-- @code src/core/mac-keymap/apply.ts#karabinerGrabsBuiltIn -->

## planMacApply

現在のkanataの設定ファイルの内容（無ければ`undefined`）とdesired stateから適用計画を組みます。
writeは行いません。`verifyMacApply`は、適用後に読み直したファイルが生成物とテキストで一致するかを
確かめます。

差分は`diffKanataText`が表示用に分けます。`deflayermap`の中は1行を1キーとし、layerと位置
（kanataのキー名をKarabinerの`key_code`名へ戻したもの）で指します。layerの外は1行を1設定とし、
`layer`を`null`にして設定の名前（`tapping-term`、`tap-hold-require-prior-idle`など）で指します。
コメントと閉じ括弧は見ません。

`karabinerGrabsBuiltIn`は`karabiner.json`から、Karabiner-Elementsが内蔵キーボードを掴むかを判定します。
選択中のprofileの`devices`に、vendor / product idを持たないキーボードを`ignore: true`にした項目が
あれば掴みません。Karabinerの「Modify events」を切るとこの項目が書かれます（R-010で確認）。
掴むときは`mac-keymap/karabiner-grabs-built-in`（warning）を出します。kanataへ入力が届かないためです。

`fingerprint`は人間の確認と適用を結びつける同一性の指紋で、テキストと診断から作ります。表示用では
ありません。CLIの`keysync mac apply`は`--confirm <fingerprint>`が一致したときだけ書き込みます。

<!-- @code src/core/mac-keymap/apply.ts#appliedTappingTermMs -->

## appliedTappingTermMs

所有するkanataの設定ファイルから、いま効いているmod-tapの閾値（`defvar tapping-term`）を読みます。
読めなければ`null`です。打鍵ログに「記録した時点で効いていた閾値」を残すのに使います（ADR 0046）。
