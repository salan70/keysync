#!/usr/bin/env bash
# KeySync を端末へ導入する。対象は Mac と Omarchy（Arch Linux）で、nix が入っていることを前提にする。
#
#   nix run github:salan70/keysync#install
#
# 1. リポジトリを clone し、その devShell の中でこのスクリプトを実行し直す
# 2. 依存パッケージと Git フックを入れる
# 3. OS ごとの準備を行う（Mac は Karabiner-Elements と kanata、Linux は keyd と udev rule）
#
# 何度実行してもよい。済んでいる手順は飛ばす。
# sudo が要る手順はまとめて行い、パスワードの入力をなるべく 1 回にする（ADR 0051）。
set -euo pipefail

readonly REPO_URL="https://github.com/salan70/keysync.git"
readonly DEFAULT_REPO="$HOME/Projects/Tools/keysync"

step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
pause() { read -r -p "    $* [Enter] " _; }

# ---------------------------------------------------------------------------
# devShell の外: clone して、devShell の中で実行し直す
# ---------------------------------------------------------------------------

# 対象のリポジトリ。KEYSYNC_REPO、keysync の checkout の中にいればそこ、どちらでもなければ既定の場所。
resolve_repo() {
  if [[ -n "${KEYSYNC_REPO:-}" ]]; then
    printf '%s\n' "$KEYSYNC_REPO"
    return
  fi
  local top
  if top=$(git rev-parse --show-toplevel 2>/dev/null) && grep -q '"name": "keysync"' "$top/package.json" 2>/dev/null; then
    printf '%s\n' "$top"
    return
  fi
  printf '%s\n' "$DEFAULT_REPO"
}

bootstrap() {
  case "$(uname -s)" in
    Darwin | Linux) ;;
    *) die "Mac と Linux（Omarchy）だけに対応する" ;;
  esac
  [[ -n "${KEYSYNC_WORKSPACE:-}" ]] ||
    die "KEYSYNC_WORKSPACE が未設定。dotfiles を入れてシェルを開き直してから、もう一度実行する"
  [[ -d "$KEYSYNC_WORKSPACE" ]] || die "KEYSYNC_WORKSPACE のディレクトリが無い: $KEYSYNC_WORKSPACE"

  local repo
  repo=$(resolve_repo)
  if [[ -d "$repo/.git" ]]; then
    step "リポジトリ: $repo"
  else
    step "リポジトリを clone する: $repo"
    mkdir -p "$(dirname "$repo")"
    git clone "$REPO_URL" "$repo"
  fi

  step "devShell を用意する（初回の Mac は kanata を build するため数分かかる）"
  KEYSYNC_INSTALL_IN_SHELL=1 exec nix develop "$repo" --command bash "$repo/tools/install.sh"
}

# ---------------------------------------------------------------------------
# devShell の中
# ---------------------------------------------------------------------------

keysync() { pnpm --silent run keysync -- "$@"; }

# 標準入力の JSON から、最上位の項目を 1 つ取り出す。
json_field() {
  node -e '
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => console.log(JSON.parse(text)[process.argv[1]] ?? ""));
  ' "$1"
}

install_common() {
  step "依存パッケージを入れる"
  pnpm install --frozen-lockfile

  step "Git フックを入れる"
  just setup
  direnv allow "$repo"
}

# --- Mac -------------------------------------------------------------------

readonly MAC_STATE="$HOME/Library/Application Support/keysync"
readonly KANATA_PLIST="/Library/LaunchDaemons/dev.keysync.kanata.plist"
readonly KARABINER_JSON="$HOME/.config/karabiner/karabiner.json"

# Karabiner-Elements が内蔵キーボードを掴んでいるか。karabiner.json が無いうちは既定で掴む。
karabiner_grabs_built_in() {
  [[ ! -f "$KARABINER_JSON" ]] || [[ "$(keysync mac service status | json_field karabinerGrabsBuiltIn)" == true ]]
}

# kanata の TCP server へ接続できるまで、最大 20 秒待つ。
wait_kanata_running() {
  local attempt
  for attempt in {1..10}; do
    [[ "$(keysync mac service status | json_field running)" == true ]] && return 0
    info "起動を待っている（$attempt/10）"
    sleep 2
  done
  return 1
}

install_mac() {
  step "Karabiner-Elements（kanata が使う仮想キーボードの提供元）"
  if [[ ! -d /Applications/Karabiner-Elements.app ]]; then
    command -v brew >/dev/null ||
      die "Karabiner-Elements が無い。https://karabiner-elements.pqrs.org/ から入れて、もう一度実行する"
    brew install --cask karabiner-elements
  fi
  until pgrep -qf Karabiner-VirtualHIDDevice-Daemon; do
    open -a Karabiner-Elements
    info "Karabiner-Elements の案内に従い、ドライバ（システム拡張）とバックグラウンド項目を許可する"
    pause "許可したら"
  done
  while karabiner_grabs_built_in; do
    open -a Karabiner-Elements
    info "Karabiner-Elements の Settings → Devices で、内蔵キーボードの Modify events を切る"
    pause "切ったら"
  done
  info "済み"

  step "kanata"
  # devShell の kanata と同じものを GC root にする。常駐の plist はこの store path を指す。
  mkdir -p "$MAC_STATE"
  nix build "$repo#kanata" --out-link "$MAC_STATE/kanata"
  local kanata
  kanata="$(readlink "$MAC_STATE/kanata")/bin/kanata"
  [[ "$(command -v kanata)" == "$kanata" ]] ||
    die "devShell の kanata（$(command -v kanata)）と build した kanata（$kanata）が違う"
  info "$kanata"

  step "kanata の設定を置く"
  if [[ -f "$MAC_STATE/kanata.kbd" ]]; then
    info "済み（以後の適用は Web UI の「kanata へ適用…」で行う）"
  else
    local plan answer
    plan=$(keysync mac apply) ||
      die "設定を生成できない。workspace に mac-keyboard.<layout>.yaml が無ければ、just ui で作ってから再実行する"
    printf '%s\n' "$plan"
    read -r -p "    この内容で kanata の設定を置く？ [y/N] " answer
    [[ "$answer" == [yY] ]] || die "中止した"
    keysync mac apply --confirm "$(json_field fingerprint <<<"$plan")"
  fi

  step "kanata を常駐させる（sudo のパスワードを求める）"
  local registered fresh=false
  registered=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$KANATA_PLIST" 2>/dev/null || true)
  if [[ "$registered" == "$kanata" ]]; then
    info "済み"
  else
    [[ -z "$registered" ]] || info "登録済みの kanata を置き換える: $registered"
    keysync mac service install || die "常駐の登録に失敗した。上の install / bootstrap の output を確かめる"
    fresh=true
  fi

  if [[ "$fresh" == true || "$(keysync mac service status | json_field running)" != true ]]; then
    step "kanata に入力監視とアクセシビリティを許可する"
    printf '%s' "$kanata" | pbcopy
    info "次の path をクリップボードへコピーした"
    info "$kanata"
    info "一覧の + を押し、⌘⇧G で path を貼り付けて追加し、スイッチを入れる"
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
    pause "入力監視に追加したら"
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    pause "アクセシビリティに追加したら"
    sudo launchctl kickstart -k system/dev.keysync.kanata
    wait_kanata_running || die "kanata が起動しない。ログは /var/log/keysync-kanata.log"
  fi
  info "kanata は常駐している"

  if [[ -x /opt/homebrew/bin/kanata || -x /usr/local/bin/kanata ]]; then
    info "Homebrew の kanata はもう使わない。消すなら: brew uninstall kanata"
  fi
}

# --- Linux（Omarchy）------------------------------------------------------

install_linux() {
  command -v pacman >/dev/null || die "Linux は Omarchy（Arch Linux）だけに対応する"

  step "keyd と Cornix LP 用の udev rule"
  local rules="$repo/docs/user-guide/linux/99-vial.rules"
  local target=/etc/udev/rules.d/99-vial.rules
  local -a commands=()
  pacman -Q keyd >/dev/null 2>&1 || commands+=("pacman -S --needed --noconfirm keyd")
  if ! systemctl is-enabled --quiet keyd 2>/dev/null || ! systemctl is-active --quiet keyd; then
    commands+=("systemctl enable --now keyd")
  fi
  if ! cmp -s "$rules" "$target"; then
    commands+=("install -D -m 0644 $(printf '%q' "$rules") $target" "udevadm control --reload" "udevadm trigger")
  fi

  if ((${#commands[@]} == 0)); then
    info "済み"
    return
  fi
  info "次を sudo で実行する（パスワードを求める）"
  printf '      %s\n' "${commands[@]}"
  local script
  script=$(printf '%s\n' "set -e" "${commands[@]}")
  sudo bash -c "$script"
  info "Cornix LP を挿し直すと、Chromium から接続できる"
}

in_shell() {
  repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  cd "$repo"

  install_common
  case "$(uname -s)" in
    Darwin) install_mac ;;
    Linux) install_linux ;;
  esac

  step "導入が済んだ"
  info "起動: cd $(printf '%q' "$repo") && just ui"
  if [[ "$(uname -s)" == Linux ]]; then
    info "内蔵キーボードの設定: docs/user-guide/linux.md の「内蔵キーボードの設定を作る」"
  fi
}

if [[ -n "${KEYSYNC_INSTALL_IN_SHELL:-}" ]]; then
  in_shell
else
  bootstrap
fi
