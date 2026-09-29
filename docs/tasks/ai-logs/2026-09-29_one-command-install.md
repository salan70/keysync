# 端末への導入を 1 コマンドにする

## 依頼

端末ごとの導入でツールの導入、sudo のパスワード、コマンドが多い。
Mac と Omarchy で、1 コマンドで導入できるようにする。
nix が入っている前提でよく、可能なら nix に寄せる。

## 判断

ADR 0051 を参照。

- 入口は `nix run github:salan70/keysync#install`（`tools/install.sh`）
- Mac の kanata は Homebrew の HEAD をやめ、`nix/kanata.nix` で commit `ac1ddb4` に固定する
- Omarchy の keyd は pacman のまま。sudo の手順を 1 回にまとめる

## 検証

- `nix/kanata.nix` の build が通り、`kanata --version` は `1.12.1-prerelease-1`、現行の `kanata.kbd` の `--check` が通った
- `tools/install.sh` は shellcheck を通った（`writeShellApplication` の build でも検査される）
- `KEYSYNC_WORKSPACE` を外すと、clone の前にエラーで止まった
- Mac で `sudo` を失敗する偽物に差し替えて通しで実行した。Karabiner と kanata の設定は「済み」と判定し、登録済みの plist が Homebrew の kanata を指していることを検出して、nix の kanata の store path で plist を生成した。`sudo install` の手前で止まることを確かめた

## 未検証

- Mac の常駐の登録し直しと、入力監視・アクセシビリティの許可（実機の launchd と TCC を書き換えるため、利用者が実行する）
- Omarchy での実行
