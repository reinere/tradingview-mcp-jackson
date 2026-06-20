import { z } from 'zod';
import { webHealthCheck, listPortfolios, getPortfolioHoldings, fetchRawPortfolioApi } from '../core/portfolio.js';

export function registerPortfolioTools(server) {
  server.tool(
    'portfolio_web_health_check',
    'Check if Chrome is running with CDP on port 9223 and TradingView is open. Run this first before any other portfolio tool.',
    {},
    async () => {
      const result = await webHealthCheck();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'portfolio_list',
    'List all TradingView portfolios with their summary (total value, P&L, performance). ' +
    'Requires Chrome running on port 9223 with TradingView open (run scripts/launch_chrome_portfolio.sh first).',
    {},
    async () => {
      const result = await listPortfolios();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'portfolio_get_holdings',
    'Get all open (and closed) holdings for a TradingView portfolio, including symbol, quantity, avg price, ' +
    'current price, market value, unrealized/realized P&L, daily change, dividends, and allocation. ' +
    'Results are sorted by market value descending. ' +
    'Leave portfolio_id empty to use the first (default) portfolio.',
    {
      portfolio_id: z.string().optional().describe(
        'Portfolio ID (UUID). Leave empty to use the first portfolio. Get IDs via portfolio_list.'
      ),
    },
    async ({ portfolio_id }) => {
      const result = await getPortfolioHoldings(portfolio_id);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'portfolio_fetch_raw',
    'Call any TradingView Portfolio API endpoint directly from within the authenticated Chrome page. ' +
    'Base: https://portfolio.tradingview.com/portfolio/v1. ' +
    'Example paths: /portfolios/, /portfolios/{id}/, /portfolios/{id}/holdings/',
    {
      path: z.string().describe(
        'API path (e.g. "/portfolios/") or full URL (e.g. "https://portfolio.tradingview.com/portfolio/v1/portfolios/")'
      ),
    },
    async ({ path }) => {
      const result = await fetchRawPortfolioApi(path);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
