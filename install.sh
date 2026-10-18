#!/bin/sh
# Installs the Steel CLI (`steel`) from the GitHub releases of
# steel-so/steel-cli, after checking its SHA-256.
#
#   curl -fsSL https://raw.githubusercontent.com/steel-so/steel-cli/main/install.sh | sh
#
# Environment:
#   STEEL_VERSION       version to install (e.g. 0.2.0); default: the latest
#   STEEL_INSTALL_DIR   where to put the binary; default: $HOME/.local/bin
#   STEEL_RELEASES_URL  base URL of the releases (tests and mirrors)
set -eu

REPO_URL="https://github.com/steel-so/steel-cli/releases"
RELEASES_URL="${STEEL_RELEASES_URL:-$REPO_URL}"
INSTALL_DIR="${STEEL_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'steel: %s\n' "$1" >&2
  [ -n "${2:-}" ] && printf '  %s\n' "$2" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "o comando $1 é necessário e não foi encontrado." "$2"
}

detect_target() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail "sistema não suportado: $os." "No Windows, baixe steel-windows-x64.zip em $REPO_URL/latest." ;;
  esac
  case "$arch" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) fail "processador não suportado: $arch." "Instale pelo npm: npm install -g @steel-so/cli" ;;
  esac
  # Rosetta: an x64 shell on Apple silicon still gets the native binary.
  if [ "$os" = darwin ] && [ "$arch" = x64 ] &&
    [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  printf '%s-%s' "$os" "$arch"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    fail "não encontrei sha256sum nem shasum para conferir o download."
  fi
}

main() {
  need curl "Instale o curl e rode de novo."
  need tar "Instale o tar e rode de novo."

  target=$(detect_target)
  asset="steel-$target.tar.gz"
  if [ -n "${STEEL_VERSION:-}" ]; then
    base="$RELEASES_URL/download/v${STEEL_VERSION#v}"
  else
    base="$RELEASES_URL/latest/download"
  fi

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT INT TERM

  say "Baixando $asset..."
  curl -fsSL "$base/$asset" -o "$tmp/$asset" ||
    fail "não consegui baixar $base/$asset." "Confira a versão em $REPO_URL."
  curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" ||
    fail "não consegui baixar $base/SHA256SUMS."

  expected=$(grep " [ *]\{0,1\}$asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1 | head -n 1)
  [ -n "$expected" ] || fail "SHA256SUMS não tem $asset."
  actual=$(sha256 "$tmp/$asset")
  [ "$expected" = "$actual" ] ||
    fail "o SHA-256 de $asset não confere; o download foi interrompido ou alterado." "Esperado $expected, recebido $actual."

  tar -xzf "$tmp/$asset" -C "$tmp"
  mkdir -p "$INSTALL_DIR"
  mv "$tmp/steel" "$INSTALL_DIR/steel"
  chmod 755 "$INSTALL_DIR/steel"

  say "Steel CLI instalado em $INSTALL_DIR/steel"
  "$INSTALL_DIR/steel" --version 2>/dev/null || true
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) say "Comece com: steel login" ;;
    *)
      say "Adicione $INSTALL_DIR ao PATH, por exemplo:"
      say "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.profile"
      ;;
  esac
}

main "$@"
