{
  description = "KeySync — 複数のキーボードのキーマップを管理するツール";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  # このフレークの責務はツールチェーンの固定と、端末への導入の入口（apps.install）だけ。
  # 導入は clone 前に動く必要があるため flake に置く（ADR 0051）。
  # それ以外のコマンドの定義元は justfile（`just --list` で一覧）。両者で重複させない。
  #
  # DocBridge は npm 配布のため nixpkgs では固定できない。バージョンの単一の
  # 定義元は .docbridge-version で、justfile / CI / pre-commit がこれを参照する。
  # スキル構成はこのバージョンと連動する（0.8.0 以降は単一の `docbridge` スキル）。
  # バージョンを上げるときは .docbridge-version を書き換えたうえで
  # `docbridge init --yes --agent-target both --force` でスキルを更新する。
  outputs = { self, nixpkgs, nixpkgs-unstable, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        unstable = import nixpkgs-unstable { inherit system; };
        kanata = unstable.callPackage ./nix/kanata.nix { };
      in
      {
        packages.kanata = kanata;

        # `nix run github:salan70/keysync#install` で、clone から OS ごとの準備までを行う。
        apps.install = {
          type = "app";
          program = pkgs.lib.getExe (pkgs.writeShellApplication {
            name = "keysync-install";
            runtimeInputs = [ pkgs.git ];
            text = builtins.readFile ./tools/install.sh;
          });
          meta.description = "KeySync を Mac / Omarchy へ導入する";
        };

        devShells.default = pkgs.mkShell {
          packages = [
            unstable.nodejs_24 # docbridge が node >= 22 を要求する
            unstable.pnpm
            pkgs.just
            pkgs.direnv
            pkgs.pre-commit
            pkgs.oxlint
            unstable.oxfmt
            pkgs.markdownlint-cli2
          ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            kanata # Mac の engine（ADR 0049、0051）
          ];

          shellHook = ''
            echo "KeySync"
            echo "  Node.js: $(node --version 2>/dev/null || echo 'not available')"
            echo "  pnpm:    $(pnpm --version 2>/dev/null || echo 'not available')"
            echo "  コマンド一覧: just --list"
          '';
        };

        formatter = pkgs.nixfmt-classic;
      });
}
