# BytesProtector — Electron Edition

Full-stack antivirus with a custom Electron GUI.

## Stack

| Layer        | Language     | Role |
|--------------|--------------|------|
| GUI          | Electron + Vanilla JS/CSS | Custom dark UI, no frameworks |
| Scan Engine  | **Python**   | Orchestrates all engines, streams JSON events |
| Heuristic    | **C**        | PE analysis, entropy, pattern matching |
| Hash Verify  | **Rust**     | SHA-256 signature lookup via Rayon |
| Browser      | **JavaScript** | Chrome/Firefox extension (see `browser-extension/`) |

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- GCC *(optional — C engine)*
- Rust + Cargo *(optional — Rust engine)*

### Run

**Windows:**
```bat
build.bat
npm start
```

**Linux / macOS:**
```bash
chmod +x build.sh && ./build.sh
npm start
```

If GCC or Cargo are missing, BytesProtector automatically falls back to pure-Python implementations.

## Build Distributable

```bash
npm run build
```
Outputs installer to `dist/`.

## Icon

Drop any `icon.png` into `assets/` — it's used everywhere (app window, taskbar, tray, installer).

## Design

- Near-black `#080809` base
- Dark grey buttons with lighter grey outlines
- DM Mono for data labels, Syne for headings
- No SaaS gradients, no purple, no blur effects
- Custom frameless titlebar with native window controls
