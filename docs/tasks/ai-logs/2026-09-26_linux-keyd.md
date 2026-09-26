# Linux（Omarchy）対応: keyd と WebHID

## 依頼

Omarchy を入れた JIS 配列の MacBook Pro でも KeySync を使えるようにする。

## 利用者の選択

- 対象: 内蔵キーボードの remap と、Cornix LP の WebHID の両方
- engine: keyd
- 設定: Mac の `mac-keyboard.jis.yaml` と共有せず、Linux 用の別ファイル
- 実機確認: 手順書を渡して利用者が行う

## Fact

keyd の `docs/keyd.scdoc` と `src/keys.c`（2026-09-26 に参照）から確認した。

- 設定は `/etc/keyd/*.conf`。`[ids]` は 16 進の `vendor:product` で、`k:` はキーボードだけを指す
- 同じ id は 1 ファイルにしか書けない
- layer は起動順に重なる stack で、どの layer にも無いキーは `main` へ落ちる
- `layer()` / `overload()` / `toggle()` / `noop` と、修飾 layer `control` / `shift` / `alt` / `meta` / `altgr` がある
- `keyd check [file]` は検証だけを行い、失敗時だけ非 0
- 日本語キーは `ro` / `yen` / `henkan` / `muhenkan` / `katakanahiragana` / `hangeul` / `hanja`

## Inference

- Apple JIS の英数 / かな（HID LANG2 / LANG1）は Linux で `hanja` / `hangeul` になる
- `backslash` と `non_us_pound` は Linux でどちらも `backslash` になる
- `mission_control` / `launchpad` は hid-apple が `scale` / `dashboard` へ写す

いずれも `spikes/r-008-linux-keyd/` で実機確認する。

## Decision

ADR 0042。

## 実装

- `src/core/linux-keymap/`: 型、parse / serialize、keyd のキー名表、生成、検証、適用計画
- `src/core/mac-keymap/validate.ts`: 位置と layer の検証を Linux と共有するため export し、診断 code の接頭辞を引数にした
- `src/linux/`: `/proc/bus/input/devices` の読み取り、keyd / sudo の境界、適用手順
- CLI `keysync linux devices|generate|diff|apply` と `just linux`
- `just ui` が Linux では `xdg-open` でブラウザを開く
- 利用者ガイド `docs/user-guide/linux.md` と udev rule

## 未完了

- Web UI で Linux の設定を表示・編集する導線。作業中に別セッションが `App.tsx` などの UI を編集中だったため、衝突を避けて今回は入れていない
- 実機確認（R-008）

## メモ

作業中に同じ作業ツリーで別セッションが ADR 0040 / 0041 を作成していたため、本件の ADR は 0042 にした。
