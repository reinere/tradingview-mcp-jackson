#!/bin/bash
# Launch TradingView Desktop with Chrome DevTools Protocol enabled
# Required for the TradingView MCP server to connect

echo "Starting TradingView with debug port 9222..."
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222 &
echo "TradingView launched. You can now use Claude Code with the tradingview MCP server."
