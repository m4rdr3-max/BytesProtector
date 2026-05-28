#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; NC='\033[0m'
log() { echo -e "${CYAN}[BUILD]${NC} $1"; }
ok()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn(){ echo -e "${YELLOW}[WARN]${NC} $1"; }

echo ""
echo "  BytesProtector — Electron Build"
echo "  ================================"
echo ""

log "npm install..."
npm install && ok "Node deps installed." || warn "npm install failed."

log "Building C engine..."
if command -v gcc &>/dev/null; then
    bash "$ROOT/backend/c/build.sh" && ok "C engine built." || warn "C build failed."
else
    warn "gcc not found — C engine skipped (Python fallback active)."
fi

log "Building Rust engine..."
if command -v cargo &>/dev/null; then
    (cd "$ROOT/backend/rust" && cargo build --release --quiet) && ok "Rust engine built." || warn "Rust build failed."
else
    warn "cargo not found — Rust engine skipped (Python fallback active)."
fi

log "Checking Python..."
if command -v python3 &>/dev/null || command -v python &>/dev/null; then
    ok "Python found."
else
    warn "Python not found — install Python 3.10+"
fi

echo ""
ok "Build complete!  Run: npm start"
echo ""
