# Mac の engine の kanata（ADR 0049）。
#
# 安定版 v1.12.0 は Karabiner-Elements 16.x の VirtualHIDDevice v8 と通信できない。
# 実機で確かめた開発版の commit へ固定する。v1.13.0 が nixpkgs に入ったらこの override を外す。
#
# commit を変えると実行ファイルの path が変わり、入力監視とアクセシビリティの許可を
# 与え直すことになる。上げるのは必要なときだけにする。
{ kanata, fetchFromGitHub, rustPlatform }:

kanata.overrideAttrs (finalAttrs: _: {
  version = "1.12.1-prerelease-1";

  src = fetchFromGitHub {
    owner = "jtroo";
    repo = "kanata";
    rev = "ac1ddb4ba47cb1dbf73539f675aaf665ab06ef9e"; # 2026-09-27
    hash = "sha256-R6ukSjJxeMcG94r5kOFqCLoWJloDuns86zD3fIulenY=";
  };

  # buildRustPackage の cargoHash は overrideAttrs では差し替わらないので、cargoDeps ごと置く。
  cargoDeps = rustPlatform.fetchCargoVendor {
    inherit (finalAttrs) pname version src;
    hash = "sha256-TMERJdGJVKS4kLq1X4bU99hpTK6TdP36ZbAbVseslJA=";
  };
})
