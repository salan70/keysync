# Linux keyboard

Linux で使う Apple 製キーボードの desired state と、keyd への生成・適用の仕様です。
判断は ADR 0042 にあります。

Mac 側（`docs/specs/mac-keymap.md`）と同じ語彙を使います。
位置は Karabiner の `key_code` 名、値は QMK 表記です。
盤面と keycode の解析は Mac 側と共有し、keyd の語彙への写像だけをこの層が持ちます。

## 位置づけ

```text
linux-keyboard.<layout>.yaml   desired state（Git 管理、workspace 直下。配列ごと）
  ↓ parseLinuxKeymapYaml
LinuxKeymapDocument            layer 番号 → (Karabiner の key_code 名 → QMK 表記)
  ↓ generateKeydConfig
/etc/keyd/keysync.conf         keyd の設定。KeySync がファイル全体を所有する
```

<!-- @code src/core/linux-keymap/types.ts#LinuxKeymapDocument -->
<!-- @code src/core/linux-keymap/types.ts#LinuxDeviceIdentifier -->

## LinuxKeymapDocument

schema 識別子は `keysync/linux-keymap@1` です。
`MacKeymapDocument` との違いは 2 つです。

- `profile` を持たない。keyd には Karabiner の profile に当たる単位が無い
- `devices` は `{ vendorId, productId }` だけを持つ。Linux には `is_built_in_keyboard` に当たる判定が無い

`layout` と `devices` に既定値はありません。
配列も適用先も推測できないため、YAML に明示させます。

<!-- @code src/core/linux-keymap/serialize.ts#serializeLinuxKeymapYaml -->

## serializeLinuxKeymapYaml

```text
schema: keysync/linux-keymap@1
layout: jis
devices:
  - { vendor_id: 1452, product_id: 638 }
layers:
  0:
    "caps_lock": "LCTL_T(KC_ESC)"
    "japanese_kana": "LT1(KC_LANG1)"
  1:
    "h": "KC_LEFT"
```

並べ方と並び順は `serializeMacKeymapYaml` と同じです。

<!-- @code src/core/linux-keymap/parse.ts#parseLinuxKeymapYaml -->

## parseLinuxKeymapYaml

serializer が出す部分集合だけを受け付け、それ以外は `LinuxKeymapParseError` で落とします。
`schema`・`layout`・`layers` のどれかが無ければ落とします。
`devices` が無い場合は空として読み、検証が `linux-keymap/no-target-device` を出します。

<!-- @code src/core/linux-keymap/key-names.ts#keydPositionName -->
<!-- @code src/core/linux-keymap/key-names.ts#keydKeyName -->

## keydKeyName

Karabiner の `key_code` 名を keyd のキー名へ写します。
位置は `keydPositionName` で直接引き、keycode は `karabinerKeyCode` で Karabiner 名へ畳んでから引きます。

表は閉じています。
次の位置は Linux に対応するキーが無く、error になります。

- `international7`〜`international9`

次の 2 つは Linux では同じ `backslash` になります。

- `backslash`
- `non_us_pound`

JIS の英数 / かなは HID の LANG2 / LANG1 で、Linux では `hanja` / `hangeul` になります。

<!-- @code src/core/linux-keymap/generate.ts#generateKeydConfig -->

## generateKeydConfig

desired state から keyd の設定を組み立てます。
出力の先頭に「生成物なので直接編集しない」というコメントを置きます。

| desired state             | keyd                     |
| ------------------------- | ------------------------ |
| layer 0                   | `[main]`                 |
| layer n                   | `[layern]`               |
| `devices` の 1 件         | `[ids]` の `k:vvvv:pppp` |
| `KC_A` など               | `a`                      |
| `MO(n)`                   | `layer(layern)`          |
| `LT n(kc)`                | `overload(layern, kc)`   |
| `TG(n)`                   | `toggle(layern)`         |
| `LCTL_T(kc)` など mod-tap | `overload(control, kc)`  |
| `KC_NO`                   | `noop`                   |
| `KC_TRNS`                 | 書かない                 |

section は `[ids]`・`[main]`・`[layer<n>]`（n 昇順）の順に並べます。
section の中は位置の `key_code` 名の昇順です。

layer n で layer 0 と同じ割り当ては書きません。
keyd は書かれていないキーを下の layer へ落とすので、書かなくても同じ結果になります。

`MO` / `LT` / `TG` が指す layer は、割り当てが無くても空の section を出します。
keyd は存在しない layer を指す設定を読み込まないためです。

mod-tap の hold 側は keyd の修飾 layer（`control` / `shift` / `alt` / `altgr` / `meta`）に落とします。
右 Alt だけが `altgr` で、他は左右を区別しません。
`SGUI_T` のような複合 modifier は keyd の `overload` で表せないため error です。

`[ids]` の id に `k:` を付けるのは、trackpad と id を共有する機種で trackpad を掴まないためです。

error の code は次のとおりです。

| code                                       | 原因                                              |
| ------------------------------------------ | ------------------------------------------------- |
| `linux-keymap/unsupported-position`        | 位置に対応する Linux のキーが無い                 |
| `linux-keymap/position-collision`          | 同じ layer の 2 つの位置が同じ Linux のキーになる |
| `linux-keymap/unsupported-keycode`         | keycode を keyd へ落とせない                      |
| `linux-keymap/unsupported-layer-tap-inner` | `LT` の tap 側を落とせない                        |
| `linux-keymap/unsupported-mod-tap`         | mod-tap を落とせない                              |

<!-- @code src/core/linux-keymap/generate.ts#linuxKeycodeSupport -->

## linuxKeycodeSupport

keycode を keyd へ落とせるかを返します。
`macKeycodeSupport` と同じく判定を書き写さず、1 キーの lowering を実際に走らせて決めます。

<!-- @code src/core/linux-keymap/validate.ts#validateLinuxKeymap -->

## validateLinuxKeymap

位置と layer の検証は Mac 側の実装を共有し、code の接頭辞だけを `linux-keymap/` にします。

- `linux-keymap/no-target-device`（error）: `devices` が空
- `linux-keymap/unknown-position`（error）: Karabiner の `key_code` に無い位置
- `linux-keymap/position-not-on-layout`（warning）: 宣言した配列に無い位置
- `linux-keymap/unknown-layer`（warning）: 書かれていない layer を指す `MO` / `LT` / `TG`
- 生成器の error
- `linux-keymap/unreachable-layer`（information）: layer 0 から辿り着けない layer

語彙に無い位置は `unknown-position` だけを出し、生成器の `unsupported-position` を重ねません。

<!-- @code src/core/linux-keymap/apply.ts#planLinuxApply -->
<!-- @code src/core/linux-keymap/apply.ts#verifyLinuxApply -->
<!-- @code src/core/linux-keymap/apply.ts#diffKeydText -->

## planLinuxApply

`/etc/keyd/keysync.conf` の現在の内容と desired state から適用計画を組みます。
filesystem・sudo・keyd には触りません。

- KeySync はファイル全体を所有します。keyd は設定ファイルを書き戻さないので、変更の有無と verify はテキストで比べます
- 表示用の差分（`diffKeydText`）は section とキーの単位で `added` / `removed` / `changed` を出します。`[ids]` の行は key が id です
- fingerprint は生成物のテキストと診断から作ります。現在のファイルの内容は含めません

<!-- @code src/core/linux-keymap/edit.ts#initialLinuxKeymap -->
<!-- @code src/core/linux-keymap/edit.ts#addLinuxDevice -->

## Linux edit

`initialLinuxKeymap` は作成時の初期状態を返します。
適用先は空で、`linux-keymap/no-target-device` が登録を促します。

`addLinuxDevice` は適用先を 1 件足します。
既にあれば何もせず、順序は追加順のまま保ちます。
id は 0〜`ffff` の整数だけを受けます。

layer と割り当ての編集は Mac 側と同じ形です。

<!-- @code src/linux/input-devices.ts#parseInputDevices -->
<!-- @code src/linux/input-devices.ts#readLinuxKeyboards -->

## readLinuxKeyboards

`/proc/bus/input/devices` から、Linux が認識しているキーボードを読みます。
一般ユーザーで読めるので root は要りません。
ファイルが無い環境（Linux 以外）では `undefined` を返します。

handler に `kbd` を持つ block だけを残します。
1 台のキーボードが複数の event node を持つため、同じ id と名前は 1 件にまとめます。
電源ボタンのように `kbd` を持つがキーボードでないものも並ぶので、登録するかは利用者が名前を見て決めます。

<!-- @code src/linux/keyd.ts#KeydHost -->
<!-- @code src/linux/keyd.ts#createKeydHost -->

## KeydHost

keyd と sudo の境界です。
test は偽物を注入し、実物の `/etc/keyd/` と keyd に触りません。

| method    | 実物の呼び出し                                   |
| --------- | ------------------------------------------------ |
| `check`   | `keyd check <path>`。keyd が無ければ `undefined` |
| `install` | `sudo install -D -m 0644 <source> <target>`      |
| `reload`  | `sudo keyd reload`                               |

`install` と `reload` は端末を引き継いで実行し、sudo のパスワードは端末で入力します。
子プロセスの出力は stderr へ回し、CLI の JSON 出力と混ぜません。

<!-- @code src/linux/apply-service.ts#planLinuxApplyAt -->
<!-- @code src/linux/apply-service.ts#applyLinuxPlan -->

## Linux 適用の境界

`planLinuxApplyAt` は `/etc/keyd/keysync.conf` を読んで計画を組みます。
error が無ければ `keysync/generated/keyd.conf` を書き、`keyd check` を通します。
`/etc/keyd/` へは書きません。

`applyLinuxPlan` は次の順で適用します。

1. 現在のファイルがあれば `keysync/backups/keyd-<時刻>.conf` へ置く
2. `sudo install` で生成物を置き換える。失敗したら reload しない
3. `sudo keyd reload`
4. 読み直して生成物とテキストで一致するかを確かめる

fingerprint の照合と `keyd check` の判定は CLI が先に済ませます。
keyd が入っていない、または `keyd check` が落ちたら書き込みません。
