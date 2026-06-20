import { ensurePortfolioChrome, evaluateWebAsync } from '../connection_web.js';

const PORTFOLIO_BASE = 'https://portfolio.tradingview.com/portfolio/v1';

// Executes an authenticated fetch() from within the Chrome page context.
// The page's session cookies are sent automatically.
async function pageFetch(url) {
  const result = await evaluateWebAsync(`
    (async () => {
      const r = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.url);
      return JSON.stringify(await r.json());
    })()
  `);
  return JSON.parse(result);
}

export async function webHealthCheck() {
  try {
    const resp = await fetch('http://localhost:9223/json/version');
    if (!resp.ok) throw new Error('Not OK');
    const version = await resp.json();
    const targets = await (await fetch('http://localhost:9223/json/list')).json();
    const tvPages = targets
      .filter(t => t.type === 'page' && /tradingview/i.test(t.url))
      .map(t => ({ url: t.url, title: t.title }));
    return {
      connected: true,
      browser: version.Browser,
      tradingview_pages: tvPages,
      hint: tvPages.length === 0
        ? 'No TradingView page open. Run: ./scripts/launch_chrome_portfolio.sh'
        : null,
    };
  } catch {
    return {
      connected: false,
      error: 'Chrome not running on port 9223.',
      hint: 'Run: ./scripts/launch_chrome_portfolio.sh',
    };
  }
}

export async function listPortfolios() {
  await ensurePortfolioChrome();
  const portfolios = await pageFetch(`${PORTFOLIO_BASE}/portfolios/`);

  return portfolios.map(p => ({
    id: p.info.portfolio_id,
    title: p.info.settings.title,
    currency: p.info.settings.currency,
    benchmark: p.info.settings.benchmark,
    description: p.info.settings.description,
    is_blocked: p.info.status.is_blocked,
    summary: p.summary?.data
      ? {
          portfolio_value: round(p.summary.data.portfolio_value),
          free_cash: round(p.summary.data.free_cash),
          open_holdings: p.summary.data.open_holdings,
          unrealized_gain: formatGain(p.summary.data.unrealized_gain),
          unrealized_gain_today: formatGain(p.summary.data.unrealized_gain_last_day),
          realized_gain: formatGain(p.summary.data.realized_gain),
          total_gain: formatGain(p.summary.data.total_gain),
          annualized_yield_pct: round(p.summary.data.annualized_yield),
          dividend_gain: round(p.summary.data.dividend_gain),
          performance_by_period: mapValues(p.summary.data.performance_by_period, round),
        }
      : null,
  }));
}

export async function getPortfolioHoldings(portfolioId) {
  await ensurePortfolioChrome();

  // If no ID given, resolve it from the portfolio list
  let id = portfolioId;
  if (!id) {
    const list = await pageFetch(`${PORTFOLIO_BASE}/portfolios/`);
    if (list.length === 0) throw new Error('No portfolios found.');
    id = list[0].info.portfolio_id;
  }

  const data = await pageFetch(`${PORTFOLIO_BASE}/portfolios/${id}/holdings/`);

  const opened = (data.holdings?.opened || []).map(formatHolding);
  const closed = (data.holdings?.closed || []).map(formatHolding);

  // Sort open positions by market value descending
  opened.sort((a, b) => b.market_value - a.market_value);

  return {
    portfolio_id: id,
    open_holdings: opened,
    closed_holdings: closed,
    summary: data.summary?.data
      ? {
          portfolio_value: round(data.summary.data.portfolio_value),
          free_cash: round(data.summary.data.free_cash),
          unrealized_gain: formatGain(data.summary.data.unrealized_gain),
          unrealized_gain_today: formatGain(data.summary.data.unrealized_gain_last_day),
          realized_gain: formatGain(data.summary.data.realized_gain),
          total_gain: formatGain(data.summary.data.total_gain),
          annualized_yield_pct: round(data.summary.data.annualized_yield),
        }
      : null,
  };
}

export async function fetchRawPortfolioApi(path) {
  await ensurePortfolioChrome();
  const url = path.startsWith('http') ? path : `${PORTFOLIO_BASE}${path}`;
  return pageFetch(url);
}

// --- helpers ---

function formatHolding(h) {
  return {
    symbol: h.symbol,
    qty: h.qty,
    avg_price: h.avg_price,
    last_price: h.last_price,
    market_value: round(h.value),
    invested: round(h.invested),
    allocation_pct: round(h.allocation),
    unrealized_gain: formatGain(h.unrealized_gain),
    daily_gain: formatGain(h.daily_gain),
    total_gain: formatGain(h.total_gain),
    dividend_gain: round(h.dividend_gain),
    annualized_yield_pct: round(h.annualized_yield),
  };
}

function formatGain(g) {
  if (!g) return null;
  return { value: round(g.v), pct: round(g.p) };
}

function round(n) {
  return typeof n === 'number' ? Math.round(n * 100) / 100 : n;
}

function mapValues(obj, fn) {
  if (!obj) return obj;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}
