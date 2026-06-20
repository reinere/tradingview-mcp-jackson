import CDP from 'chrome-remote-interface';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

let client = null;
let targetInfo = null;
const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9223;
const MAX_RETRIES = 3;
const BASE_DELAY = 500;

const LAUNCH_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'scripts', 'launch_chrome_portfolio.sh'
);
const LAUNCH_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 500;

// Ensures debug Chrome is running AND the TradingView session is authenticated.
// Idempotent: warm path (Chrome up + session ready) returns in < 1s.
// Called by data tools only — health check deliberately does NOT use this.
export async function ensurePortfolioChrome() {
  // Fast path: already running and authenticated
  if (await isAuthReady()) return;

  // Port down → launch Chrome (also resets any stale CDP client)
  if (!await isCdpPortUp()) {
    if (client) { try { await client.close(); } catch {} client = null; targetInfo = null; }
    spawn('/bin/bash', [LAUNCH_SCRIPT], { detached: true, stdio: 'ignore' }).unref();
  }

  // Poll until auth-ready or timeout
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    if (await isAuthReady()) return;
  }

  // Distinguish: Chrome never started vs. Chrome up but session invalid
  if (!await isCdpPortUp()) {
    throw new Error(
      `Debug Chrome did not start within ${LAUNCH_TIMEOUT_MS / 1000}s. ` +
      'Try "tvchrome" in a terminal to diagnose.'
    );
  }
  throw new Error(
    `Debug Chrome is running but the TradingView session is not authenticated ` +
    `after ${LAUNCH_TIMEOUT_MS / 1000}s. ` +
    'Log into TradingView in the Chrome window and retry.'
  );
}

// Three-stage readiness probe:
// 1. CDP port answers  2. A TradingView page is loaded  3. Portfolio API returns 200
async function isAuthReady() {
  if (!await isCdpPortUp()) return false;

  // Check whether a TradingView page exists (avoids slow CDP connect to a blank tab)
  try {
    const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
    const targets = await resp.json();
    const hasTvPage = targets.some(t => t.type === 'page' && /tradingview\.com/i.test(t.url));
    if (!hasTvPage) return false;
  } catch {
    return false;
  }

  // Auth probe via page-context fetch — 200 = session ready, anything else = not yet
  try {
    const status = await evaluateWebAsync(`
      (async () => {
        try {
          const r = await fetch('https://portfolio.tradingview.com/portfolio/v1/portfolios/', {
            credentials: 'include',
            headers: { Accept: 'application/json' }
          });
          return r.status;
        } catch {
          return 0;
        }
      })()
    `);
    return status === 200;
  } catch {
    return false;
  }
}

async function isCdpPortUp() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/version`, { signal: controller.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

export async function getWebClient() {
  if (client) {
    try {
      await client.Runtime.evaluate({ expression: '1', returnByValue: true });
      return client;
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  return connectWeb();
}

export async function connectWeb() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const target = await findWebTarget();
      if (!target) {
        throw new Error(
          'No Chrome page found on port 9223.\n' +
          'Run: ./scripts/launch_chrome_portfolio.sh'
        );
      }
      targetInfo = target;
      client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });
      await client.Runtime.enable();
      await client.Page.enable();
      await client.Network.enable();
      return client;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 5000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(
    `Chrome CDP connection failed: ${lastError?.message}\n` +
    'Run: ./scripts/launch_chrome_portfolio.sh'
  );
}

async function findWebTarget() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  return (
    targets.find(t => t.type === 'page' && /tradingview\.com\/portfolios/i.test(t.url)) ||
    targets.find(t => t.type === 'page' && /tradingview\.com/i.test(t.url)) ||
    targets.find(t => t.type === 'page') ||
    null
  );
}

export async function evaluateWeb(expression, opts = {}) {
  const c = await getWebClient();
  const result = await c.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: opts.awaitPromise ?? false,
    timeout: opts.timeout ?? 20000,
    ...opts,
  });
  if (result.exceptionDetails) {
    const msg =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateWebAsync(expression) {
  return evaluateWeb(expression, { awaitPromise: true });
}

export async function navigateWeb(url, waitMs = 4000) {
  const c = await getWebClient();
  await c.Page.navigate({ url });
  await new Promise(r => setTimeout(r, waitMs));
}

// Capture JSON API responses whose URLs match urlPatterns while fn() runs.
// Returns array of { url, data } objects.
export async function captureJsonResponses(urlPatterns, fn, extraWaitMs = 3000) {
  const c = await getWebClient();
  const results = [];
  const pending = new Map();

  const onResponse = ({ requestId, response, type }) => {
    if (type !== 'XHR' && type !== 'Fetch') return;
    const url = response.url;
    const isJson =
      response.mimeType?.includes('json') ||
      (response.headers?.['content-type'] || '').includes('json');
    if (isJson && urlPatterns.some(p => p.test(url))) {
      pending.set(requestId, url);
    }
  };

  const onFinished = async ({ requestId }) => {
    if (!pending.has(requestId)) return;
    const url = pending.get(requestId);
    pending.delete(requestId);
    try {
      const { body } = await c.Network.getResponseBody({ requestId });
      results.push({ url, data: JSON.parse(body) });
    } catch {}
  };

  c.on('Network.responseReceived', onResponse);
  c.on('Network.loadingFinished', onFinished);

  try {
    await fn();
    await new Promise(r => setTimeout(r, extraWaitMs));
  } finally {
    c.removeListener('Network.responseReceived', onResponse);
    c.removeListener('Network.loadingFinished', onFinished);
  }

  return results;
}

export async function disconnectWeb() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

export async function getWebTargetInfo() {
  if (!targetInfo) await getWebClient();
  return targetInfo;
}
