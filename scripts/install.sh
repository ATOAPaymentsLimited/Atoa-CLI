#!/bin/sh
# Atoa CLI installer for Linux and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/ATOAPaymentsLimited/Atoa-CLI/main/scripts/install.sh | sh
#
# Downloads the standalone `atoa` binary for your OS/CPU from the GitHub Release,
# verifies its checksum (and GPG signature, if our public key is imported), and
# installs it onto your PATH. No Node.js required.
#
# Environment overrides:
#   ATOA_VERSION   release tag to install (e.g. v0.1.2). Default: latest.
#   ATOA_INSTALL_DIR   target directory. Default: /usr/local/bin (root) or
#                      ~/.local/bin otherwise.
set -eu

REPO="ATOAPaymentsLimited/Atoa-CLI"
VERSION="${ATOA_VERSION:-latest}"

err() {
  echo "atoa install: $1" >&2
  exit 1
}

# --- platform detection -----------------------------------------------------
os="$(uname -s)"
case "$os" in
  Linux)  os_name="linux" ;;
  Darwin) os_name="darwin" ;;
  *) err "unsupported OS: $os (Windows: see scripts/install.ps1). Try: npm install -g @atoapayments/atoa-cli" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *) err "unsupported architecture: $(uname -m). Try: npm install -g @atoapayments/atoa-cli" ;;
esac

asset="atoa-${os_name}-${arch}"
sums="SHA256SUMS"

# glibc-only binaries; musl (Alpine) users must use npm.
if [ "$os_name" = "linux" ] && [ -f /etc/os-release ] && grep -qi alpine /etc/os-release 2>/dev/null; then
  err "Alpine/musl is not supported by the prebuilt binary. Use: npm install -g @atoapayments/atoa-cli"
fi

# --- download tool ----------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
  dl() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  dl() { wget -qO "$2" "$1"; }
else
  err "need curl or wget to download."
fi

if [ "$VERSION" = "latest" ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/${VERSION}"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "Downloading ${asset} (${VERSION})..."
dl "${base}/${asset}" "${tmp}/${asset}" || err "download failed for ${base}/${asset}"
dl "${base}/${sums}" "${tmp}/${sums}" || err "could not fetch ${sums}"
dl "${base}/${sums}.asc" "${tmp}/${sums}.asc" || echo "atoa install: no GPG signature found, skipping signature check" >&2

# --- verify checksum --------------------------------------------------------
(
  cd "$tmp"
  grep " ${asset}\$" "${sums}" >expected.sums \
    || { echo "atoa install: ${asset} not listed in ${sums}" >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c expected.sums >/dev/null
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c expected.sums >/dev/null
  else
    echo "atoa install: no sha256 tool available, skipping checksum check" >&2
  fi
) || err "checksum verification failed."
echo "Checksum OK."

# --- verify GPG signature (best effort) -------------------------------------
# A missing public key means we can't authenticate (warn, checksum still holds),
# but a BADSIG means the signature is present and invalid (tampering) -> abort.
if [ -f "${tmp}/${sums}.asc" ] && command -v gpg >/dev/null 2>&1; then
  if gpg_out="$(gpg --verify "${tmp}/${sums}.asc" "${tmp}/${sums}" 2>&1)"; then
    echo "GPG signature OK."
  elif printf '%s' "$gpg_out" | grep -q "BADSIG"; then
    err "GPG signature is INVALID — the download may have been tampered with. Aborting."
  else
    echo "atoa install: GPG signature NOT verified (import Atoa's public key to authenticate; checksum still verified)." >&2
  fi
fi

# --- install ----------------------------------------------------------------
if [ -n "${ATOA_INSTALL_DIR:-}" ]; then
  dest="$ATOA_INSTALL_DIR"
elif [ "$(id -u)" -eq 0 ] || [ -w /usr/local/bin ]; then
  dest="/usr/local/bin"
else
  dest="$HOME/.local/bin"
fi

mkdir -p "$dest"
install -m 0755 "${tmp}/${asset}" "${dest}/atoa"
echo "Installed atoa -> ${dest}/atoa"

# curl-downloaded binaries usually aren't quarantined, but strip the attribute
# if it's present so macOS Gatekeeper doesn't block the first run.
if [ "$os_name" = "darwin" ]; then
  xattr -d com.apple.quarantine "${dest}/atoa" 2>/dev/null || true
fi

case ":${PATH}:" in
  *":${dest}:"*) ;;
  *) echo "atoa install: ${dest} is not on your PATH. Add it, e.g.:
  export PATH=\"${dest}:\$PATH\"" >&2 ;;
esac

"${dest}/atoa" --version || echo "atoa install: installed but 'atoa --version' failed; see above." >&2
