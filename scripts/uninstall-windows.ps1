# Removes deck. Your memory, settings and issues are kept unless you type DELETE.
$ErrorActionPreference = "Continue"
Get-Process deck -ErrorAction SilentlyContinue | Stop-Process -Force
$Un = Join-Path $env:LOCALAPPDATA "deck\uninstall.exe"
if (Test-Path $Un) { Start-Process $Un -ArgumentList "/S" -Wait; Write-Host "Removed deck." } else { Write-Host "deck was not found in $env:LOCALAPPDATA\deck." }
$Data = Join-Path $env:APPDATA "dev.deck.desktop"
$a = Read-Host "Also delete your memory, settings and issues in $Data? This cannot be undone. Type DELETE to confirm, or press Enter to keep them"
if ($a -eq "DELETE") { Remove-Item -Recurse -Force $Data -ErrorAction SilentlyContinue; Write-Host "Deleted. Keychain entries stay in Windows Credential Manager under dev.deck.app." } else { Write-Host "Kept your data." }
$t = Read-Host "Remove the build tools in $env:LOCALAPPDATA\deck-tools? [y/N]"
if ($t -eq "y") { Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA "deck-tools") -ErrorAction SilentlyContinue; Write-Host "Removed." }
Read-Host "Done. Press Enter to close"
