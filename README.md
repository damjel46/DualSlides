# DualSlide

> Run independent slideshow wallpapers on each of your monitors — no stretching, no mirroring, no compromises.

[![Steam](https://img.shields.io/badge/Steam-DualSlide-1b2838?logo=steam&logoColor=white)](https://store.steampowered.com/app/4631820/DualSlide/)
[![Platform](https://img.shields.io/badge/Windows-10%2F11-0078d4?logo=windows&logoColor=white)](https://store.steampowered.com/app/4631820/DualSlide/)
[![Built with Tauri](https://img.shields.io/badge/Tauri-2.0-ffc131?logo=tauri&logoColor=white)](https://tauri.app)
[![Price](https://img.shields.io/badge/Price-%242.00-brightgreen)](https://store.steampowered.com/app/4631820/DualSlide/)

Windows' built-in wallpaper settings apply the same image to every monitor. DualSlide lets each display run its own slideshow — different folders, different schedules, fully independent.

---

## Features

### Slideshow & Image Management
- **Per-monitor independent slideshows** — assign different folders and image sources to each display
- **Multi-source** — combine multiple folders and individual images into a single source pool per monitor
- **Favorites** — mark images as favorites; they appear 3× more often in shuffle mode
- **Pin** — lock the current image so the slideshow won't advance past it
- **Supported formats**: JPG, JPEG, PNG, BMP, WEBP

### Automation & Scheduling
- **Time-based schedule** — divide the day into up to 6 time slots and auto-switch image sources (e.g. landscapes in the morning, cityscapes at night)
- **Auto-pause on fullscreen** — detects fullscreen apps and games, pauses automatically, resumes when you exit

### Display Control
- **Monitor sync** — switch all monitors to the next/previous image simultaneously with one action
- **Zen Mode** — one hotkey hides the taskbar and all desktop icons for a clean, distraction-free view
- **Per-monitor taskbar** — independently show or hide the taskbar on each display
- **Crossfade transitions** — smooth DWM crossfade between wallpapers; no hard cuts

### System Integration
- **Global hotkeys** — control previous / next / pause from any app in any context
- **Profiles** — save your entire monitor configuration as a named profile and switch instantly
- **System tray** — lives quietly in the background; always one click away
- **Launch on startup** — auto-resumes your slideshow when Windows starts
- **8 languages** — English, Korean, Japanese, Chinese, German, Spanish, French, Italian

---

## Tech Stack

| Layer | Technology |
|---|---|
| App Framework | Tauri 2.0 |
| Frontend | React 18 + TypeScript + Vite |
| Backend | Rust + Tokio (async) |
| Styling | Tailwind CSS + framer-motion |
| Wallpaper Engine | more-wallpapers |
| Settings | tauri-plugin-store (JSON) |
| Global Hotkeys | tauri-plugin-global-shortcut |
| Autostart | tauri-plugin-autostart |
| i18n | i18next + react-i18next |
| Image Validation | image crate |
| Shuffle | rand crate |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable toolchain)

### Development

```bash
npm install
npx tauri dev
```

### Build

```bash
npx tauri build
```

Output: `src-tauri/target/release/bundle/nsis/DualSlide_x.x.x_x64-setup.exe`

---

## System Requirements

| | Minimum |
|---|---|
| OS | Windows 10 64-bit |
| CPU | Intel Core i3 or equivalent |
| RAM | 2 GB |

---

## Changelog

| Date | Changes |
|---|---|
| 2026-06 | Steam release, icon refresh, drag-and-drop improvements |
| 2026-04 | Time-based schedule + multi-source support |
| 2026-03 | Favorites & Pin implemented |
| 2026-03 | Zen Mode — hotkey for immersive wallpaper view |
| 2026-03 | Monitor sync + per-monitor taskbar control |
| 2026-03 | All features made free (Pro tier removed) |
| 2026-03 | Initial release — multi-monitor slideshow engine |

---

## Links

- [Steam Store](https://store.steampowered.com/app/4631820/DualSlide/)

---

Built with [Tauri](https://tauri.app) — not Electron, so it stays lightweight and out of your RAM.
