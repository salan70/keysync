#!/usr/bin/env bash
# R-008: Omarchy の MacBook で ADR 0042 の Open Question を観測する。
# 読み取りだけを行う。/etc/keyd/ への書き込みと keyd reload はしない。
# 使い方: bash spikes/r-008-linux-keyd/observe.sh > r-008.txt 2>&1
set -u

section() { printf '\n===== %s =====\n' "$1"; }

section "OS"
uname -a
grep -E '^(NAME|VERSION_ID|BUILD_ID)=' /etc/os-release

section "MacBook のモデル"
cat /sys/class/dmi/id/product_name 2>/dev/null || echo "(dmi 無し)"

section "keyd"
command -v keyd && keyd --version
systemctl is-active keyd || true
ls -l /etc/keyd/ 2>/dev/null || echo "(/etc/keyd 無し)"
for file in /etc/keyd/*.conf; do
  [ -e "$file" ] || continue
  printf -- '--- %s [ids]\n' "$file"
  awk '/^\[ids\]/{on=1;next} /^\[/{on=0} on && NF' "$file"
done

section "キーボード（/proc/bus/input/devices の kbd）"
awk 'BEGIN{RS=""} /Handlers=[^\n]*kbd/' /proc/bus/input/devices

section "hid_apple の parameter（fnmode など）"
for param in /sys/module/hid_apple/parameters/*; do
  [ -e "$param" ] || { echo "(hid_apple 無し)"; break; }
  printf '%s=%s\n' "$(basename "$param")" "$(cat "$param")"
done

section "hidraw と Vial の serial（Cornix LP の WebHID 権限）"
for node in /dev/hidraw*; do
  [ -e "$node" ] || continue
  walk=$(udevadm info --attribute-walk --name="$node" 2>/dev/null)
  serial=$(printf '%s\n' "$walk" | grep -m1 'ATTRS{serial}' || true)
  name=$(printf '%s\n' "$walk" | grep -m1 -E 'ATTRS\{(name|product)\}' || true)
  printf '%s %s | %s | %s\n' "$(ls -l "$node" | awk '{print $1, $3, $4}')" "$node" "$name" "$serial"
  getfacl -p "$node" 2>/dev/null | grep '^user:' || true
done

section "生成物の keyd check"
generated="${KEYSYNC_WORKSPACE:-}/keysync/generated/keyd.conf"
if [ -f "$generated" ]; then
  keyd check "$generated" && echo "keyd check: ok"
else
  echo "($generated が無い。先に just linux apply を実行する)"
fi

section "手で確かめること"
cat <<'MANUAL'
sudo keyd monitor を起動し、内蔵キーボードで次を押して表示されたキー名を記録する。
  英数 / かな / fn / F1 / fn+F1 / ¥ / _ / 左右の Command / Option
Ctrl+C で終える。keyd monitor は読むだけで設定を変えない。
MANUAL
