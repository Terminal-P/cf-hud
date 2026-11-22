# Build the Windows installers locally.
#
# Usage (PowerShell, from the repository root or anywhere):
#   powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
#
# Produces (unsigned):
#   src-tauri/target/release/bundle/nsis/CF HUD_<version>_x64-setup.exe
#   src-tauri/target/release/bundle/msi/CF HUD_<version>_x64_en-US.msi

$ErrorActionPreference = "Stop"

Set-Location (Split-Path $PSScriptRoot -Parent)

function Require-Command($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing '$name'. $hint"
  }
}

Require-Command "node" "Install Node.js 20 or newer: https://nodejs.org/"
Require-Command "cargo" "Install Rust (stable-msvc) with rustup: https://rustup.rs/"
Require-Command "npm" "npm ships with Node.js."

$rustHost = (& rustc -vV | Select-String "^host:").ToString()
Write-Host "Rust toolchain: $rustHost"
if ($rustHost -notmatch "windows-msvc") {
  throw "The Windows MSVC toolchain is required. Run: rustup default stable-msvc"
}

Write-Host "Installing frontend dependencies..."
npm ci

Write-Host "Building Tauri bundles (this may take several minutes on the first run)..."
npm run tauri build -- --bundles nsis,msi

Write-Host ""
Write-Host "Build finished. Installers:"
Get-ChildItem "src-tauri\target\release\bundle" -Recurse -Include *.exe, *.msi |
  Select-Object FullName, @{ Name = "SizeMB"; Expression = { [math]::Round($_.Length / 1MB, 1) } } |
  Format-Table -AutoSize

Write-Host ""
Write-Host "Note: the installers are unsigned, so Windows SmartScreen may warn on first launch."
Write-Host "See docs/BUILD-WINDOWS.md for code-signing options."
