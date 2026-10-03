# One-click installer for deck on Windows 10 and 11 (64-bit).
# Started by "Install deck.cmd". Installs build tools if missing (asks for permission), keeps private
# copies of Node and Rust in %LOCALAPPDATA%\deck-tools, builds deck from this folder, installs it, and opens it.
# First run takes about 20 to 40 minutes (the Visual Studio C++ tools are a large download).

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Repo = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $env:LOCALAPPDATA "deck-tools"
$Log = Join-Path $env:LOCALAPPDATA "deck-install.log"
New-Item -ItemType Directory -Force -Path (Join-Path $Tools "bin") | Out-Null
Start-Transcript -Path $Log -Append | Out-Null

function Step($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Fail($t) {
  Write-Host "`nInstall stopped: $t" -ForegroundColor Red
  Write-Host "Full log: $Log"
  Stop-Transcript | Out-Null
  Read-Host "Press Enter to close"
  exit 1
}
function Run($exe, [string[]]$a) {
  & $exe @a
  if ($LASTEXITCODE -ne 0) { Fail "$exe $($a -join ' ') failed (exit $LASTEXITCODE)." }
}

try {
  if (-not [Environment]::Is64BitOperatingSystem) { Fail "deck needs 64-bit Windows." }
  if (-not (Test-Path (Join-Path $Repo "pnpm-workspace.yaml"))) { Fail "run Install deck.cmd from inside the unzipped deck folder." }
  $Winget = Get-Command winget -ErrorAction SilentlyContinue

  Step "1/6 Visual Studio C++ build tools"
  $VsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  $HasVc = (Test-Path $VsWhere) -and (& $VsWhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
  if (-not $HasVc) {
    if (-not $Winget) { Fail "install 'Visual Studio Build Tools 2022' with the 'Desktop development with C++' workload, then run this again." }
    Write-Host "Installing the C++ build tools (several GB). Windows may ask for permission."
    Run winget @("install", "--id", "Microsoft.VisualStudio.2022.BuildTools", "-e", "--accept-package-agreements", "--accept-source-agreements", "--override", "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended")
  }
  Write-Host "Ready."

  Step "2/6 WebView2 runtime"
  $wv = Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
  if (-not $wv -and $Winget) { Run winget @("install", "--id", "Microsoft.EdgeWebView2Runtime", "-e", "--accept-package-agreements", "--accept-source-agreements") }
  Write-Host "Ready."

  Step "3/6 Node.js 22 (private copy)"
  $NodeDir = Join-Path $Tools "node"
  $NodeExe = Join-Path $NodeDir "node.exe"
  $ok = (Test-Path $NodeExe) -and ((& $NodeExe -e "process.stdout.write(process.versions.node.split('.')[0])") -ge 22)
  if (-not $ok) {
    $Base = "https://nodejs.org/dist/latest-v22.x"
    $Sums = (Invoke-WebRequest -UseBasicParsing "$Base/SHASUMS256.txt").Content -split "`n"
    $Line = $Sums | Where-Object { $_ -match "node-v[\d.]+-win-x64\.zip$" } | Select-Object -First 1
    if (-not $Line) { Fail "could not find a Node.js download." }
    $Hash, $File = ($Line -split "\s+")
    $Zip = Join-Path $Tools $File
    Invoke-WebRequest -UseBasicParsing "$Base/$File" -OutFile $Zip
    if ((Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower() -ne $Hash.ToLower()) { Fail "the Node.js download did not match its checksum." }
    if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
    Expand-Archive $Zip -DestinationPath $Tools -Force
    Move-Item (Join-Path $Tools ($File -replace "\.zip$", "")) $NodeDir
    Remove-Item $Zip
  }
  $env:Path = "$NodeDir;$(Join-Path $Tools 'bin');$env:Path"
  Write-Host "Node $(& node --version)."

  Step "4/6 pnpm"
  $env:COREPACK_HOME = Join-Path $Tools "corepack"
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
  Run corepack @("enable", "--install-directory", (Join-Path $Tools "bin"), "pnpm")
  Write-Host "pnpm $(& pnpm --version)."

  Step "5/6 Rust (private copy via rustup)"
  $env:RUSTUP_HOME = Join-Path $Tools "rustup"
  $env:CARGO_HOME = Join-Path $Tools "cargo"
  $Cargo = Join-Path $env:CARGO_HOME "bin\cargo.exe"
  if (-not (Test-Path $Cargo)) {
    $Init = Join-Path $Tools "rustup-init.exe"
    Invoke-WebRequest -UseBasicParsing "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile $Init
    Run $Init @("-y", "--profile", "minimal", "--default-toolchain", "stable", "--default-host", "x86_64-pc-windows-msvc", "--no-modify-path")
    Remove-Item $Init
  }
  $env:Path = "$(Join-Path $env:CARGO_HOME 'bin');$env:Path"
  Write-Host "$(& rustc --version)."

  Step "6/6 Building and installing deck (the slow part)"
  Push-Location $Repo
  Run pnpm @("install", "--frozen-lockfile")
  Run node @("scripts/package-engine.mjs")
  Run pnpm @("--filter", "@deck/desktop", "tauri", "build", "--bundles", "nsis", "--config", "src-tauri/tauri.bundle.conf.json")
  Pop-Location
  $Setup = Get-ChildItem (Join-Path $Repo "apps\desktop\src-tauri\target\release\bundle\nsis\*-setup.exe") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $Setup) { Fail "the build finished but the installer was not found." }
  Get-Process deck -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Process -FilePath $Setup.FullName -ArgumentList "/S" -Wait
  $App = Join-Path $env:LOCALAPPDATA "deck\deck.exe"

  Write-Host "`ndeck is installed." -ForegroundColor Green
  Write-Host "Your memory, settings and keys are kept between installs. To update, unzip the new version and run Install deck.cmd again."
  if (Test-Path $App) { Start-Process $App }
  Stop-Transcript | Out-Null
  Read-Host "Press Enter to close"
} catch {
  Fail $_.Exception.Message
}
