#!/usr/bin/env bash
# R-009 Spike: 物理層（IOHID）と OS 層（CGEventTap）を同時に記録する。
# 使い方: spikes/r-009-key-observe/run.sh [秒数]
# 起動後「recording」と出たら、秒数のあいだ任意の場所で打鍵する。
# nix の devShell は SDKROOT を古い SDK に固定するため、Xcode の SDK へ差し替えて実行する。
set -euo pipefail
cd "$(dirname "$0")"
seconds="${1:-10}"
out="${TMPDIR:-/tmp}/r-009-$(date +%s)"
mkdir -p "$out"
sdk="$(env -u SDKROOT -u DEVELOPER_DIR /usr/bin/xcrun --sdk macosx --show-sdk-path)"
build() {
  env -u DEVELOPER_DIR -u MACOSX_DEPLOYMENT_TARGET SDKROOT="$sdk" \
    /usr/bin/swiftc -O "$1.swift" -o "$out/$1" 2>&1
}
build hid-observe
build event-tap
"$out/hid-observe" "$seconds" > "$out/hid.jsonl" &
"$out/event-tap" "$seconds" > "$out/tap.jsonl" &
sleep 0.5
echo "recording ${seconds}s → $out"
wait
echo "--- hid ($(grep -c '"type":"hid"' "$out/hid.jsonl" || true) events)"
cat "$out/hid.jsonl"
echo "--- tap ($(grep -c '"type":"event"' "$out/tap.jsonl" || true) events)"
cat "$out/tap.jsonl"
