#Requires -Version 5.1
# Atoa CLI installer for Windows.
#
#   Latest:           irm https://cli.atoa.me/latest/install.ps1 | iex
#   A given version:  irm https://cli.atoa.me/v0.4.0/install.ps1 | iex
#              or:    & ([scriptblock]::Create((irm https://cli.atoa.me/latest/install.ps1))) -Version 0.4.0
#
# Downloads atoa.exe for your CPU (zipped), verifies its checksum and
# Authenticode signature, and installs it onto your PATH.
# No Node.js required. Re-run it to upgrade. Non-interactive: safe for CI and AI
# agents (`powershell -c "irm ... | iex"` exits 1 on any failure).
#
# Version, first match wins: -Version, then $env:ATOA_VERSION, then the release
# this installer was downloaded from.
#
# Environment overrides:
#   $env:ATOA_VERSION         version to install (e.g. 0.4.0 or v0.4.0).
#   $env:ATOA_INSTALL_DIR     target directory. Default: %LOCALAPPDATA%\Atoa\bin.
#   $env:ATOA_NO_MODIFY_PATH  set to 1 to never edit the User PATH.
#   $env:ATOA_DOWNLOAD_URL    download from a mirror with the same layout as cli.atoa.me
#                             (<url>/latest/VERSION, <url>/v<version>/<file>). GitHub works
#                             for a given version:
#                             https://github.com/ATOAPaymentsLimited/Atoa-CLI/releases/download
param([string]$Version)

# Everything runs in a child scope and fails with `throw`, never `exit`: under
# `irm | iex` this script runs inside the caller's session, so `exit` would close
# their terminal and preference changes would leak into it.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # the progress bar makes 5.1 downloads crawl
  Set-StrictMode -Version Latest

  # The release workflow replaces 'latest' with the release's own tag in the copy it
  # publishes, so an installer downloaded from a given release installs that release.
  $ReleaseTag = 'latest'
  $Downloads = if ($env:ATOA_DOWNLOAD_URL) { $env:ATOA_DOWNLOAD_URL.TrimEnd('/') } else { 'https://cli.atoa.me' }
  $VersionPattern = '^v?\d+\.\d+\.\d+(-rc\.\d+)?$'
  $Version = if ($Version) { $Version } elseif ($env:ATOA_VERSION) { $env:ATOA_VERSION } else { $ReleaseTag }
  if ($Version -ne 'latest' -and $Version -notmatch $VersionPattern) {
    throw "atoa install: invalid version '$Version' (expected e.g. 0.4.0, v0.4.0 or latest)"
  }

  # --- platform detection ---------------------------------------------------
  # 32-bit PowerShell on 64-bit Windows reports x86; the real CPU is in ...W6432.
  $cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  switch ($cpu) {
    'AMD64' { $arch = 'x64' }
    # No native arm64 build yet; Windows on ARM runs x64 binaries via emulation.
    'ARM64' { $arch = 'x64' }
    default { throw "atoa install: unsupported architecture: $cpu. Try: npm install -g @atoapayments/atoa-cli" }
  }
  $asset = "atoa-windows-$arch.zip"
  $sums = 'SHA256SUMS'

  # Add TLS 1.2 without removing what the caller's session already allows.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  # --- resolve download base ------------------------------------------------
  # "latest" resolves to an exact version first, and every file then comes from
  # that version's folder, so an install never mixes files from two releases.
  if ($Version -eq 'latest') {
    try {
      $latest = (Invoke-WebRequest -Uri "$Downloads/latest/VERSION" -UseBasicParsing).Content
    } catch {
      throw "atoa install: could not read the latest version from $Downloads/latest/VERSION: $($_.Exception.Message)"
    }
    if ($latest -is [byte[]]) { $latest = [Text.Encoding]::UTF8.GetString($latest) }
    $Version = "$latest".Trim()
    if ($Version -notmatch $VersionPattern) {
      throw "atoa install: unexpected latest version '$Version' from $Downloads/latest/VERSION"
    }
  }
  $Version = "v$($Version.TrimStart('v'))"
  $base = "$Downloads/$Version"

  $tmp = Join-Path $env:TEMP ('atoa-install-' + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $dest = if ($env:ATOA_INSTALL_DIR) { $env:ATOA_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Atoa\bin' }
  $dest = [IO.Path]::GetFullPath($dest).TrimEnd('\') # absolute, so the PATH entry works anywhere
  $exe = Join-Path $dest 'atoa.exe'

  try {
    Write-Host "Downloading $asset ($Version)..."
    try {
      Invoke-WebRequest -Uri "$base/$asset" -OutFile (Join-Path $tmp $asset) -UseBasicParsing
      Invoke-WebRequest -Uri "$base/$sums" -OutFile (Join-Path $tmp $sums) -UseBasicParsing
    } catch {
      throw "atoa install: download failed: $($_.Exception.Message)"
    }

    # --- verify checksum ----------------------------------------------------
    $line = Get-Content (Join-Path $tmp $sums) |
      Where-Object { $_ -match "\s\*?$([regex]::Escape($asset))$" } | Select-Object -First 1
    if (-not $line) { throw "atoa install: $asset not listed in $sums" }
    $expected = ($line -split '\s+')[0].ToLower()
    $actual = (Get-FileHash (Join-Path $tmp $asset) -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) {
      throw "atoa install: checksum verification failed (expected $expected, got $actual)"
    }
    Write-Host 'Checksum OK.'

    # --- unpack (only after the archive has been verified) ------------------
    $unpacked = Join-Path $tmp 'unpacked'
    Expand-Archive -Path (Join-Path $tmp $asset) -DestinationPath $unpacked
    $downloaded = Join-Path $unpacked 'atoa.exe'
    if (-not (Test-Path -LiteralPath $downloaded)) { throw "atoa install: atoa.exe not found in $asset" }

    # --- verify Authenticode signature --------------------------------------
    # Valid alone would accept any publisher's certificate, so the signer must be
    # Atoa. Match the organization, not a thumbprint: the certificates rotate often.
    $sig = Get-AuthenticodeSignature $downloaded
    if ($sig.Status -ne 'Valid') {
      throw "atoa install: Authenticode signature not valid (status: $($sig.Status)). Aborting."
    }
    if ($sig.SignerCertificate.Subject -notmatch '(^|,\s*)O=Atoa Payments Limited(,|$)') {
      throw "atoa install: signed by '$($sig.SignerCertificate.Subject)', not Atoa Payments Limited. Aborting."
    }
    Write-Host "Authenticode signature OK ($($sig.SignerCertificate.Subject))."

    # --- install ------------------------------------------------------------
    # A running atoa.exe can't be overwritten but can be renamed, so move the
    # old one aside first (put back if the new one can't be moved in). Copies
    # still in use are left behind and removed by a later run.
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Get-ChildItem -Path $dest -Filter 'atoa.exe.old-*' | Remove-Item -Force -ErrorAction SilentlyContinue
    $old = "$exe.old-$([Guid]::NewGuid())"
    if (Test-Path $exe) { Move-Item -Force $exe $old }
    try {
      Move-Item -Force $downloaded $exe
    } catch {
      if (Test-Path $old) { Move-Item -Force $old $exe }
      throw "atoa install: could not install $exe ($($_.Exception.Message)); the previous version was kept."
    }
    Remove-Item -Force $old -ErrorAction SilentlyContinue
    Write-Host "Installed atoa -> $exe"
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }

  # --- ensure dest is on the User PATH --------------------------------------
  # Read and write the raw registry value: $env:Path also holds the machine
  # PATH, and SetEnvironmentVariable would store REG_SZ and break %VAR% entries.
  if (-not $env:ATOA_NO_MODIFY_PATH) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    try {
      $rawPath = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $entries = @($rawPath -split ';' | Where-Object { $_ })
      $expanded = @($entries | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') })
      if ($expanded -notcontains $dest) {
        # First, so it wins over an older npm-installed atoa (%APPDATA%\npm) in the User PATH.
        $key.SetValue('Path', ((@($dest) + $entries) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
        # Setting and clearing a User variable broadcasts WM_SETTINGCHANGE, so
        # terminals opened from now on pick up the new PATH.
        [Environment]::SetEnvironmentVariable('ATOA_INSTALLER_PATH_REFRESH', '1', 'User')
        [Environment]::SetEnvironmentVariable('ATOA_INSTALLER_PATH_REFRESH', $null, 'User')
        Write-Host "Added $dest to your User PATH."
      }
    } finally {
      $key.Close()
    }
  }
  if (($env:Path -split ';') -notcontains $dest) { $env:Path = "$dest;$env:Path" }

  # Which atoa a new terminal will run: Machine PATH comes before User PATH.
  # Advisory only: odd PATH entries (missing drives, quotes) are skipped, never fatal.
  $nextPath = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  $winner = $null
  foreach ($dir in ($nextPath -split ';')) {
    if ($winner -or -not $dir) { continue }
    $dir = [Environment]::ExpandEnvironmentVariables($dir).Trim('"').TrimEnd('\')
    foreach ($name in 'atoa.exe', 'atoa.cmd') {
      try { if (-not $winner -and (Test-Path -LiteralPath "$dir\$name")) { $winner = "$dir\$name" } } catch { }
    }
  }
  if ($winner -and ($winner -ne $exe)) {
    Write-Host "atoa install: new terminals will run $winner first (e.g. an npm install). Remove it (npm uninstall -g @atoapayments/atoa-cli) or move $dest earlier in PATH." -ForegroundColor Yellow
  }

  & $exe --version
  if ($LASTEXITCODE -ne 0) { throw "atoa install: installed $exe but 'atoa --version' failed." }
  Write-Host "Run 'atoa login' to get started."
}
