#Requires -Version 5.1
# Atoa CLI installer for Windows.
#
#   irm https://raw.githubusercontent.com/ATOAPaymentsLimited/Atoa-CLI/main/scripts/install.ps1 | iex
#
# Downloads the standalone atoa.exe for your CPU from the GitHub Release, verifies
# its checksum and Authenticode signature, and installs it onto your PATH.
# No Node.js required.
#
# Environment overrides:
#   $env:ATOA_VERSION       release tag to install (e.g. v0.1.2). Default: latest.
#   $env:ATOA_INSTALL_DIR   target directory. Default: %LOCALAPPDATA%\Atoa\bin.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repo = 'ATOAPaymentsLimited/Atoa-CLI'
$Version = if ($env:ATOA_VERSION) { $env:ATOA_VERSION } else { 'latest' }

function Fail($msg) {
  Write-Host "atoa install: $msg" -ForegroundColor Red
  exit 1
}

# --- platform detection -----------------------------------------------------
switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { $arch = 'x64' }
  # No native arm64 build yet; Windows on ARM runs x64 binaries via emulation.
  'ARM64' { $arch = 'x64' }
  default { Fail "unsupported architecture: $($env:PROCESSOR_ARCHITECTURE). Try: npm install -g @atoapayments/atoa-cli" }
}
$asset = "atoa-windows-$arch.exe"
$sums = 'SHA256SUMS'

# --- resolve download base --------------------------------------------------
if ($Version -eq 'latest') {
  $base = "https://github.com/$Repo/releases/latest/download"
} else {
  $base = "https://github.com/$Repo/releases/download/$Version"
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$tmp = Join-Path $env:TEMP ("atoa-install-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
$dest = if ($env:ATOA_INSTALL_DIR) { $env:ATOA_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Atoa\bin' }
$exe = Join-Path $dest 'atoa.exe'

try {
  Write-Host "Downloading $asset ($Version)..."
  try {
    Invoke-WebRequest -Uri "$base/$asset" -OutFile (Join-Path $tmp $asset) -UseBasicParsing
    Invoke-WebRequest -Uri "$base/$sums" -OutFile (Join-Path $tmp $sums) -UseBasicParsing
  } catch {
    Fail "download failed: $($_.Exception.Message)"
  }

  # --- verify checksum ------------------------------------------------------
  $line = Get-Content (Join-Path $tmp $sums) |
    Where-Object { $_ -match [regex]::Escape($asset) } | Select-Object -First 1
  if (-not $line) { Fail "$asset not listed in $sums" }
  $expected = ($line -split '\s+')[0].ToLower()
  $actual = (Get-FileHash (Join-Path $tmp $asset) -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) {
    Fail "checksum verification failed (expected $expected, got $actual)"
  }
  Write-Host "Checksum OK."

  # --- verify Authenticode signature ----------------------------------------
  $sig = Get-AuthenticodeSignature (Join-Path $tmp $asset)
  if ($sig.Status -ne 'Valid') {
    Fail "Authenticode signature not valid (status: $($sig.Status)). Aborting."
  }
  Write-Host "Authenticode signature OK ($($sig.SignerCertificate.Subject))."

  # --- install --------------------------------------------------------------
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Move-Item -Force (Join-Path $tmp $asset) $exe
  Write-Host "Installed atoa -> $exe"
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# --- ensure dest is on the User PATH ----------------------------------------
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @()
if ($userPath) { $entries = $userPath -split ';' | Where-Object { $_ } }
if ($entries -notcontains $dest) {
  [Environment]::SetEnvironmentVariable('Path', (($entries + $dest) -join ';'), 'User')
  $env:Path = "$env:Path;$dest"
  Write-Host "Added $dest to your User PATH. Restart your terminal for it to take effect."
}

try { & $exe --version } catch {
  Write-Host "atoa install: installed but 'atoa --version' failed: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host "Run 'atoa login' to get started."
