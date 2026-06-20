#!/usr/bin/env node
// One-time discovery script: captures all API calls on the TradingView portfolio page.
// Run after launch_chrome_portfolio.sh to identify the real API endpoints.
//
// Usage: node scripts/portfolio_discovery.js [port]

import CDP from 'chrome-remote-interface';

const PORT = parseInt(process.argv[2] || '9223', 10);
const WAIT_MS = 8000;

async function main() {
  console.log(`Connecting to Chrome on port ${PORT}...`);

  let targets;
  try {
    const resp = await fetch(`http://localhost:${PORT}/json/list`);
    targets = await resp.json();
  } catch {
    console.error(`Cannot reach Chrome on port ${PORT}.`);
    console.error('Run: ./scripts/launch_chrome_portfolio.sh');
    process.exit(1);
  }

  const target =
    targets.find(t => t.type === 'page' && /tradingview\.com/i.test(t.url)) ||
    targets.find(t => t.type === 'page');

  if (!target) {
    console.error('No page targets found. Open Chrome first.');
    process.exit(1);
  }

  console.log(`Attaching to: ${target.url}\n`);

  const client = await CDP({ host: 'localhost', port: PORT, target: target.id });
  await client.Runtime.enable();
  await client.Page.enable();
  await client.Network.enable();

  const captured = [];
  const pendingBodies = new Map();

  client.on('Network.responseReceived', ({ requestId, response, type }) => {
    if (type !== 'XHR' && type !== 'Fetch') return;
    if (!/tradingview\.com/i.test(response.url)) return;
    pendingBodies.set(requestId, { url: response.url, status: response.status, mime: response.mimeType });
  });

  client.on('Network.loadingFinished', async ({ requestId }) => {
    if (!pendingBodies.has(requestId)) return;
    const meta = pendingBodies.get(requestId);
    pendingBodies.delete(requestId);
    let body = null;
    try {
      const r = await client.Network.getResponseBody({ requestId });
      body = r.body?.slice(0, 600);
    } catch {}
    captured.push({ ...meta, body_preview: body });
  });

  console.log('Navigating to https://www.tradingview.com/portfolios/ ...');
  await client.Page.navigate({ url: 'https://www.tradingview.com/portfolios/' });

  process.stdout.write(`Waiting ${WAIT_MS / 1000}s for API calls to complete`);
  for (let i = 0; i < WAIT_MS / 500; i++) {
    await new Promise(r => setTimeout(r, 500));
    process.stdout.write('.');
  }
  console.log('\n');

  // Also check global window keys that might expose portfolio state
  let windowKeys = [];
  try {
    const result = await client.Runtime.evaluate({
      expression: `JSON.stringify(
        Object.keys(window).filter(k =>
          /portfolio|position|holding|account|watchlist/i.test(k)
        ).slice(0, 30)
      )`,
      returnByValue: true,
    });
    windowKeys = JSON.parse(result.result?.value || '[]');
  } catch {}

  await client.close();

  console.log('=== API Calls Captured ===\n');
  if (captured.length === 0) {
    console.log('(none — page may already be cached or login required)');
  }
  for (const c of captured) {
    console.log(`[${c.status}] ${c.url}`);
    if (c.body_preview) {
      console.log(`  Preview: ${c.body_preview.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    console.log();
  }

  console.log('=== Global window keys (portfolio-related) ===\n');
  if (windowKeys.length === 0) {
    console.log('(none found)');
  } else {
    windowKeys.forEach(k => console.log(`  window.${k}`));
  }

  console.log('\n=== Summary ===');
  console.log(`Total API calls: ${captured.length}`);
  console.log('Pass these URLs to src/core/portfolio.js PORTFOLIO_PATTERNS');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
