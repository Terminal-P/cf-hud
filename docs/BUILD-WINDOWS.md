# Building the Windows desktop app

CF HUD's desktop build is a Tauri 2 application: the same React frontend wrapped in a Rust shell with a frameless, always-on-top window.

Two supported ways to get a Windows installer:

1. **On a Windows machine** — build locally with Rust (fastest to iterate).
2. **On GitHub Actions** — run the `Windows installer` workflow; no Windows machine needed.

The instructions below produce:

- NSIS installer: `src-tauri/target/release/bundle/nsis/CF HUD_<version>_x64-setup.exe` (per-user, no admin rights)
- MSI: `src-tauri/target/release/bundle/msi/CF HUD_<version>_x64_en-US.msi`

Both are **unsigned** by default. Windows SmartScreen will show "Unknown publisher" on first launch; this is expected for a hobby project and is fixed by code signing (see below).

## 中文速览

- **有 Windows 电脑**：装好 Node 20+、Rust（MSVC 工具链）、Visual Studio Build Tools 的「使用 C++ 的桌面开发」，然后 `npm ci && npm run tauri build`。
- **没有 Windows 电脑**：把仓库推到 GitHub → Actions → **Windows installer** → Run workflow → 下载 `cf-hud-windows` 产物（内含 `.exe` 和 `.msi`）。
- 产物路径：`src-tauri/target/release/bundle/nsis/*.exe`、`.../msi/*.msi`。
- 安装包未签名，首次运行 Windows 会提示「未知发布者」，点「更多信息 → 仍要运行」。
- Linux 上**不能**直接交叉编译出官方支持的 Windows 安装包，请用 Windows 机器或 GitHub 的 `windows-latest` runner。
- 打 tag（`v0.1.0`）会触发 `release.yml`，同时构建 Windows / macOS / Linux 并创建 draft release。

## Option A: build on Windows

### Prerequisites

1. **Node.js 20 or newer** (CI uses 22) with npm.
2. **Rust** via [rustup](https://rustup.rs), default toolchain. The MSVC toolchain is required:
   ```powershell
   rustup default stable-msvc
   ```
3. **Visual Studio 2022 Build Tools** with the **Desktop development with C++** workload (MSVC compiler, Windows 10/11 SDK). The Rust linker needs `link.exe`.
4. **WebView2 Runtime** — preinstalled on Windows 11 and most updated Windows 10 machines. The bundled installer uses the embedded WebView2 bootstrapper, so it can install the runtime if it is missing.

### Build

```powershell
git clone https://github.com/Terminal-P/cf-hud.git
cd cf-hud
npm ci
npm run tauri build
```

Or run the helper script, which checks the prerequisites, builds both bundles and prints the output paths:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

`npm run tauri build` runs `npm run build` (typecheck + Vite production build) through `beforeBuildCommand`, then compiles the Rust shell and bundles the installers. The first build takes a few minutes because Rust dependencies are compiled from scratch; later builds are incremental.

To build only the NSIS installer (skips WiX/MSI):

```powershell
npm run tauri build -- --bundles nsis
```

### Output

```
src-tauri/target/release/bundle/nsis/CF HUD_0.1.0_x64-setup.exe
src-tauri/target/release/bundle/msi/CF HUD_0.1.0_x64_en-US.msi
```

The NSIS installer is per-user (`installMode: currentUser`): it installs under `%LOCALAPPDATA%` and does not require administrator rights. It ships with English and Simplified Chinese installer languages.

### First run

The app opens as a 400×620 frameless window (minimum 320×180) that stays on top. Settings:

- The window position and size are remembered across restarts by `tauri-plugin-window-state`.
- `Ctrl+Shift+H` toggles always-on-top.
- The window has no title bar; drag it by the header area.
- Closing the window quits the app (there is no tray icon yet).

## Option B: build with GitHub Actions (no Windows machine)

The repository ships a manual workflow that builds the Windows bundles on a `windows-latest` runner and uploads them as an artifact:

1. Push the repository to GitHub (or fork it).
2. Open **Actions → Windows installer → Run workflow**.
3. Leave `bundles` as `nsis,msi` (or set `nsis` only).
4. When the run finishes, download the **`cf-hud-windows`** artifact from the run summary. It contains the `.exe` and `.msi` installers.

Alternatively, push a version tag to build a draft release for all platforms:

```bash
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` then builds Windows, macOS and Linux bundles with `tauri-action` and creates a draft GitHub release. Review it, then publish.

## Code signing (optional, recommended for distribution)

Without a certificate, Windows shows a SmartScreen warning. Signing is configured in `src-tauri/tauri.conf.json` under `bundle.windows`, either with an Authenticode certificate thumbprint or a custom `signCommand`. You then provide the certificate on the build machine/runner. Options:

- an EV/OV code-signing certificate (hardware token or cloud HSM);
- Azure Trusted Signing;
- SignPath / other signing services;
- signing the generated `.exe`/`.msi` after `tauri build` with `signtool`.

Never commit certificates or passwords; use CI secrets.

## Cross-compiling from Linux or macOS

Tauri does not officially support cross-compiling Windows installers from Linux/macOS. Experimental setups (`cargo-xwin` for `x86_64-pc-windows-msvc`, or `llvm-mingw` for the GNU target) can produce a binary, but the NSIS/MSI bundling and WebView2 integration are the fragile parts. Recommended path: use the GitHub Actions workflow above, which is free for public repositories.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `link.exe not found` / `msvc` errors | Install Visual Studio Build Tools with the C++ workload and Windows SDK; run `rustup default stable-msvc`. |
| `WebView2` missing at runtime | Install the Evergreen WebView2 Runtime, or rebuild with `bundle.windows.webviewInstallMode.type = "offlineInstaller"`. |
| Build fails downloading WiX | Build only NSIS: `npm run tauri build -- --bundles nsis`. |
| SmartScreen blocks the installer | Expected for unsigned builds; sign the binaries or click "More info → Run anyway". |
| Antivirus flags the NSIS installer | Common false positive for unsigned NSIS installers; sign the binary to reduce it. |
| `npm ci` fails | Use Node 20+ and make sure `package-lock.json` is committed. |
| Long paths on Windows | Enable long path support in Windows, or clone to a short path such as `C:\dev\cf-hud`. |
