#!/bin/sh
# Atoa CLI installer for Linux and macOS.
#
#   curl -fsSL https://github.com/ATOAPaymentsLimited/Atoa-CLI/releases/latest/download/install.sh | sh
#
# Downloads the standalone `atoa` binary for your OS/CPU from the GitHub Release,
# verifies its checksum (and GPG signature, if our public key is imported), and
# installs it onto your PATH. No Node.js required. Re-run it to upgrade.
# Non-interactive: safe for CI and AI agents. Exits non-zero on any failure.
#
# Environment overrides:
#   ATOA_VERSION         version to install (e.g. 0.4.0 or v0.4.0). Default: latest.
#   ATOA_INSTALL_DIR     target directory. Default: /usr/local/bin (root or writable)
#                        or ~/.local/bin otherwise.
#   ATOA_NO_MODIFY_PATH  set to 1 to never edit shell startup files.
#   ATOA_DOWNLOAD_URL    download from this base URL instead of GitHub (a mirror).
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
  *) err "unsupported OS: $os (Windows: use install.ps1). Try: npm install -g @atoapayments/atoa-cli" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *) err "unsupported architecture: $(uname -m). Try: npm install -g @atoapayments/atoa-cli" ;;
esac

# An x64 shell running under Rosetta on Apple silicon still gets the native binary.
if [ "$os_name" = "darwin" ] && [ "$arch" = "x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  arch="arm64"
fi

asset="atoa-${os_name}-${arch}"
sums="SHA256SUMS"

# --- download tool ----------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
  dl() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  dl() { wget -qO "$2" "$1"; }
else
  err "need curl or wget to download."
fi

if [ -n "${ATOA_DOWNLOAD_URL:-}" ]; then
  base="${ATOA_DOWNLOAD_URL%/}"
elif [ "$VERSION" = "latest" ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/v${VERSION#v}"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "Downloading ${asset} (${VERSION})..."
dl "${base}/${asset}" "${tmp}/${asset}" || err "download failed for ${base}/${asset}"
dl "${base}/${sums}" "${tmp}/${sums}" || err "could not fetch ${base}/${sums}"
dl "${base}/${sums}.asc" "${tmp}/${sums}.asc" 2>/dev/null || rm -f "${tmp}/${sums}.asc" # optional; checked below

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
    echo "atoa install: need sha256sum or shasum to verify the download" >&2
    exit 1
  fi
) || err "checksum verification failed."
echo "Checksum OK."

# --- verify GPG signature ---------------------------------------------------
# If you have imported Atoa's release key (atoa-release-signing-key.asc, attached
# to every release), SHA256SUMS must carry a valid signature from exactly that
# key, or the install aborts. Without the key we can't authenticate, so warn
# (the checksum is still verified).
ATOA_KEY_FPR="CD41B3FD0E27808CAF7D7BDF5C3CBA695F1BE613"
if command -v gpg >/dev/null 2>&1 && gpg --list-keys "$ATOA_KEY_FPR" >/dev/null 2>&1; then
  [ -f "${tmp}/${sums}.asc" ] || err "no ${sums}.asc found, so the download can't be authenticated. Aborting."
  gpg --status-fd 1 --verify "${tmp}/${sums}.asc" "${tmp}/${sums}" 2>/dev/null \
    | grep -q "^\[GNUPG:\] VALIDSIG .*${ATOA_KEY_FPR}" \
    || err "GPG signature is INVALID or not from Atoa — the download may have been tampered with. Aborting."
  echo "GPG signature OK."
else
  echo "atoa install: GPG signature not checked (import atoa-release-signing-key.asc to authenticate; checksum verified)." >&2
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
dest="$(cd "$dest" && pwd)" # absolute, so the PATH entry works from any directory
install -m 0755 "${tmp}/${asset}" "${dest}/atoa"
echo "Installed atoa -> ${dest}/atoa"

# curl-downloaded binaries usually aren't quarantined, but strip the attribute
# if it's present so macOS Gatekeeper doesn't block the first run.
if [ "$os_name" = "darwin" ]; then
  xattr -d com.apple.quarantine "${dest}/atoa" 2>/dev/null || true
fi

# --- PATH -------------------------------------------------------------------
case ":${PATH}:" in
  *":${dest}:"*) ;;
  *)
    if [ -n "${ATOA_NO_MODIFY_PATH:-}" ]; then
      echo "atoa install: ${dest} is not on your PATH. Add it with: export PATH=\"${dest}:\$PATH\"" >&2
    else
      case "$(basename "${SHELL:-sh}")" in
        zsh) rc="$HOME/.zshrc"; line="export PATH=\"${dest}:\$PATH\"" ;;
        # macOS Terminal opens login shells, which read ~/.bash_profile, not ~/.bashrc.
        bash) if [ "$os_name" = "darwin" ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi
          line="export PATH=\"${dest}:\$PATH\"" ;;
        fish) rc="$HOME/.config/fish/config.fish"; line="fish_add_path \"${dest}\"" ;;
        *) rc="$HOME/.profile"; line="export PATH=\"${dest}:\$PATH\"" ;;
      esac
      mkdir -p "$(dirname "$rc")"
      if ! grep -qsF "$line" "$rc"; then
        printf '\n# Added by the Atoa CLI installer\n%s\n' "$line" >>"$rc"
      fi
      echo "Added ${dest} to your PATH in ${rc}. Open a new terminal, or run: ${line}"
    fi
    ;;
esac

found="$(command -v atoa 2>/dev/null || true)"
if [ -n "$found" ] && [ "$found" != "${dest}/atoa" ]; then
  echo "atoa install: another atoa at ${found} comes first on your PATH (e.g. an npm install). Remove it (npm uninstall -g @atoapayments/atoa-cli) or put ${dest} first." >&2
fi

"${dest}/atoa" --version || err "installed ${dest}/atoa but 'atoa --version' failed."
echo "Run 'atoa login' to get started."
