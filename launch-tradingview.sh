#!/bin/bash
# Launch TradingView Desktop with Chrome DevTools Protocol enabled
# Required for the TradingView MCP server to connect

LOG_FILE="$HOME/.tradingview-mcp/tv.out"
mkdir -p "$(dirname "$LOG_FILE")"

echo "Starting TradingView with debug port 9222 (output → $LOG_FILE) ..."
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222 >"$LOG_FILE" 2>&1 &
echo "PID: $!  |  tail -f $LOG_FILE"
