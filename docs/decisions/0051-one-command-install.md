# 端末への導入を nix run の 1 コマンドにし、Mac の kanata を flake で固定する

状態: 採用

2026-09-29 に、端末ごとの導入で打つコマンドと sudo の入力が多いという利用者の要望を受けて決めた。

## 背景

導入の手順は利用者ガイドに散らばっていた。

- 共通: clone、`direnv allow`、`pnpm install`、`just setup`
- Mac: Karabiner-Elements の導入、「Modify events」を切る、`brew install --HEAD kanata`、`just mac apply` を 2 回、`just mac service install`、入力監視とアクセシビリティの許可
- Omarchy: `pacman -S keyd`、`systemctl enable --now keyd`、udev rule の配置と読み直し

確認した事実。

- Fact: nixpkgs の kanata は安定版 v1.12.0 で、Karabiner-Elements 16.x の VirtualHIDDevice v8 と通信できない（ADR 0049）
- Fact: nixpkgs の kanata を commit `ac1ddb4`（利用者が Homebrew の HEAD で実機確認した版）へ override して build でき、現行の `kanata.kbd` の `--check` が通った
- Fact: `buildRustPackage` の `cargoHash` は `overrideAttrs` では差し替わらない。`cargoDeps` を置き換える必要がある
- Fact: nix が build した kanata は ad-hoc 署名で、store path は build し直さない限り変わらない
- Fact: 入力監視とアクセシビリティの許可、Karabiner のドライバの許可、「Modify events」の切り替えは GUI の操作で、スクリプトから行えない

## 選択肢

入口について。

1. `nix run github:salan70/keysync#install`（flake の app）
2. `curl … | bash`
3. clone 後に `just install`

Mac の kanata について。

1. Homebrew の HEAD のまま
2. flake で commit を固定して build する

Omarchy の keyd について。

1. pacman
2. flake で入れ、systemd の unit を自前で置く

## 決定

入口は案 1、kanata は案 2、keyd は案 1（pacman）を採る。

- `apps.install` は `tools/install.sh` を実行する。clone したあと、そのリポジトリの devShell の中で自分を実行し直す
- clone 先は `KEYSYNC_REPO`、keysync の checkout の中ならそこ、どちらも無ければ `~/Projects/Tools/keysync` とする
- 何度実行してもよい形にする。済んでいる手順は状態を見て飛ばす
- GUI の操作が要る手順では、該当する画面を開いて Enter を待ち、状態を確かめ直す
- kanata は `nix/kanata.nix` で固定し、Mac の devShell に入れる。`~/Library/Application Support/keysync/kanata` を GC root にし、常駐の plist は store path を指す
- 登録済みの plist が別の kanata を指していれば、登録し直して許可をやり直す
- 初回の `kanata.kbd` は、差分を表示して y の入力を受けてから置く
- Omarchy では sudo が要る手順をまとめ、`sudo bash -c` の 1 回で行う
- `KEYSYNC_WORKSPACE` は dotfiles が設定する。導入スクリプトはシェルの設定に書き込まず、未設定なら止まる

## 理由

- **clone の前に動く入口が要る。** justfile は devShell の中でしか使えない。flake の app なら nix だけで動き、スクリプトの取得も nix が固定する
- **kanata を固定すると許可のやり直しが減る。** Homebrew の HEAD は入れ直すたびに実体が変わる。flake の固定なら、commit を上げたときだけ変わる
- **store path は root 所有で書き換えられない。** root の daemon が利用者の書ける場所の実行ファイルを起動しない
- **keyd は OS の service である。** pacman の package は `/usr/bin/keyd` と systemd の unit を持ち、`sudo keyd reload` が sudo の `secure_path` で解決できる。flake で入れると unit と GC root を自前で持つことになる（ADR 0042 も Arch の公式 repo を理由に keyd を選んだ）
- **`kanata.kbd` の初回の配置も人間が確認する。** 導入の途中でも、設定の書き込みは差分と fingerprint の確認を経る（ADR 0028）

## 影響

- 初めての Mac では kanata を build するため、導入に数分かかる
- kanata の commit を上げると store path が変わり、入力監視とアクセシビリティを許可し直す。v1.13.0 が nixpkgs に入ったら override を外す
- Homebrew の kanata は使わなくなる。探索の候補（`KanataHost`）には残す
- Karabiner-Elements は nix で入れられない（ドライバの有効化に GUI の許可が要る）。無ければ Homebrew の cask で入れる
- ADR 0049 の「`brew install --HEAD kanata` で入れる」を置き換える
- Omarchy 側の手順は実機でまだ通していない
