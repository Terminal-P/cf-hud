# CF HUD desktop shell (Tauri 2)

This directory contains the Tauri 2 wrapper for the Vite + React web app in the
repository root. The web frontend owns all UI and Codeforces API traffic; Rust
only registers the plugins the HUD needs.

## Files

| Path | Purpose |
| --- | --- |
| `Cargo.toml` | Rust package `cf-hud`; library crate `cf_hud_lib` |
| `build.rs` | `tauri_build::build()` (config/capability/ACL codegen) |
| `src/main.rs` | Desktop entry point, no console window on Windows release |
| `src/lib.rs` | `run()`: builder + global-shortcut, notification & window-state plugins |
| `tauri.conf.json` | Window, CSP and bundle configuration |
| `capabilities/default.json` | Permissions granted to the `main` window |
| `icons/` | Generated platform icons |
| `scripts/gen-icon.mjs` | Dependency-free generator for `assets/icon.png` |

## Prerequisites

- Node.js 22+ and `npm`
- Rust stable 1.90+ (`rustup`) — required by `tauri-plugin-window-state`
- Linux only: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev build-essential`

## Development

```sh
npm install        # once, from the repository root
npm run tauri dev  # starts Vite on http://127.0.0.1:1420 and opens the HUD
```

`npm run tauri build` produces the platform installers in
`src-tauri/target/release/bundle/`.

## Configuration notes

- **Window**: 400x620, minimum 320x180, frameless (`decorations: false`),
  transparent, always-on-top, centered, with a native shadow.
- **CSP**: the production policy only allows `https://codeforces.com` and
  `https://*.codeforces.com` in `connect-src` (plus `self` and the Tauri IPC
  endpoints). `devCsp` additionally allows the Vite dev server
  (`http://127.0.0.1:1420`, `ws://127.0.0.1:1420`) and inline scripts required by
  React Fast Refresh.
- **Capabilities**: `capabilities/default.json` grants `core:default` plus the
  window controls used by the HUD (drag, always-on-top, position/size,
  show/hide, focus, minimize, close), the global shortcut commands and
  `notification:default`.
- **Window state**: `tauri-plugin-window-state` is registered Rust-side only
  (`Builder::default()`), so the HUD's position/size (and default
  maximize/visibility/decoration/fullscreen flags) are saved to
  `.window-state.json` in the app config directory on close and restored on the
  next launch. It needs no JavaScript bindings and no capability permission —
  those only gate its optional IPC commands.
- Tauri appends its own nonces/hashes to the CSP at compile time; do not be
  surprised that the bundled `index.html` policy differs slightly from the conf.

## Icons

`assets/icon.png` is generated (no image dependencies) by:

```sh
node src-tauri/scripts/gen-icon.mjs
```

Then regenerate every platform icon into `src-tauri/icons/`:

```sh
npx tauri icon assets/icon.png
```
