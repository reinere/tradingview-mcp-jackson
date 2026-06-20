#!/bin/bash
# Launch Chrome with CDP on port 9223 for TradingView Portfolio access.
#
# Uses a DEDICATED profile at ~/.chrome-tv-debug (NOT your default Chrome).
# This means:
#   - Normal Chrome and this debug instance run in parallel, no quitting needed.
#   - Works with Chrome 136+ (which ignores --remote-debugging-port on the default profile).
#   - FIRST RUN: fresh profile — log into TradingView manually once.
#
# Usage: ./scripts/launch_chrome_portfolio.sh [port]

PORT="${1:-9223}"
DEBUG_PROFILE="$HOME/.chrome-tv-debug"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL="https://www.tradingview.com/portfolios/"

# ── Idempotency: port-specific check only (not pgrep — that false-positives on normal Chrome) ──
if curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
  echo "Debug Chrome already running on port $PORT — nothing to do."
  targets=$(curl -s "http://127.0.0.1:$PORT/json/list")
  echo "$targets" | python3 -c "
import json, sys
targets = json.load(sys.stdin)
tv = [t for t in targets if 'tradingview' in t.get('url', '')]
print(f'TradingView pages: {len(tv)}')
for t in tv:
    print(f'  {t[\"url\"]}')
" 2>/dev/null || true
  exit 0
fi

# ── Sanity check ──
if [ ! -f "$CHROME" ]; then
  echo "Error: Chrome not found at: $CHROME"
  exit 1
fi

# ── First-run notice ──
if [ ! -d "$DEBUG_PROFILE" ]; then
  echo "First run: creating dedicated debug profile at $DEBUG_PROFILE"
  echo "→ Log into TradingView manually once after Chrome opens."
  echo ""
fi

echo "Launching debug Chrome on port $PORT..."
echo "Profile : $DEBUG_PROFILE"
echo "Opening : $URL"
echo ""

"$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$DEBUG_PROFILE" \
  "$URL" \
  > /dev/null 2>&1 &

echo "Waiting for CDP..."
for i in $(seq 1 20); do
  if curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
    browser=$(curl -s "http://127.0.0.1:$PORT/json/version" \
      | python3 -c "import json,sys; print(json.load(sys.stdin).get('Browser','?'))" 2>/dev/null)
    echo "CDP ready — $browser"
    if [ ! -d "$DEBUG_PROFILE/Default" ]; then
      echo ""
      echo "⚠  Fresh profile — log into TradingView in the Chrome window, then use portfolio_* tools."
    fi
    exit 0
  fi
  sleep 1
done

echo "Warning: CDP not responding after 20s."
echo "Check: curl http://127.0.0.1:$PORT/json/version"
exit 1
