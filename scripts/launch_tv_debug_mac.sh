#!/bin/bash
# Launch TradingView Desktop on macOS with Chrome DevTools Protocol enabled.
# Usage: ./scripts/launch_tv_debug_mac.sh [port]

PORT="${1:-9222}"
LOG_FILE="$HOME/.tradingview-mcp/tv.out"
mkdir -p "$(dirname "$LOG_FILE")"

# ── Idempotency: if CDP already answers on this port, do nothing ──
if curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
  echo "TradingView already running with CDP on port $PORT — nothing to do."
  curl -s "http://127.0.0.1:$PORT/json/version" \
    | python3 -m json.tool 2>/dev/null \
    || curl -s "http://127.0.0.1:$PORT/json/version"
  exit 0
fi

# ── Auto-detect TradingView install location ──
APP=""
LOCATIONS=(
  "/Applications/TradingView.app/Contents/MacOS/TradingView"
  "$HOME/Applications/TradingView.app/Contents/MacOS/TradingView"
)

for loc in "${LOCATIONS[@]}"; do
  if [ -f "$loc" ]; then
    APP="$loc"
    break
  fi
done

# Fallback: Spotlight
if [ -z "$APP" ]; then
  APP=$(mdfind "kMDItemCFBundleIdentifier == 'com.niceincontact.TradingView'" 2>/dev/null | head -1)
  [ -n "$APP" ] && APP="$APP/Contents/MacOS/TradingView"
fi

# Fallback: find
if [ -z "$APP" ] || [ ! -f "$APP" ]; then
  APP=$(find /Applications "$HOME/Applications" -name "TradingView.app" -maxdepth 2 2>/dev/null | head -1)
  [ -n "$APP" ] && APP="$APP/Contents/MacOS/TradingView"
fi

if [ -z "$APP" ] || [ ! -f "$APP" ]; then
  echo "Error: TradingView not found."
  echo "Checked: /Applications/TradingView.app, ~/Applications/TradingView.app"
  echo ""
  echo "If installed elsewhere, run manually:"
  echo "  /path/to/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=$PORT"
  exit 1
fi

# Kill any existing TradingView (only reached if CDP wasn't answering)
pkill -f "TradingView" 2>/dev/null
sleep 1

echo "Found TradingView at: $APP"
echo "Launching with --remote-debugging-port=$PORT (output → $LOG_FILE) ..."
"$APP" --remote-debugging-port=$PORT >"$LOG_FILE" 2>&1 &
TV_PID=$!
echo "PID: $TV_PID  |  tail -f $LOG_FILE"

# Wait for CDP
echo "Waiting for CDP..."
for i in $(seq 1 15); do
  if curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
    echo "CDP ready at http://127.0.0.1:$PORT"
    curl -s "http://127.0.0.1:$PORT/json/version" \
      | python3 -m json.tool 2>/dev/null \
      || curl -s "http://127.0.0.1:$PORT/json/version"
    exit 0
  fi
  sleep 1
done

echo "Warning: CDP not responding after 15s. TradingView may still be loading."
echo "Check manually: curl http://127.0.0.1:$PORT/json/version"
