
import { loadStocks } from "./appService.js";

function seededNoise(seed, index) {
  const x = Math.sin(seed * 999 + index * 37.77) * 10000;
  return x - Math.floor(x);
}

function symbolSeed(symbol) {
  return String(symbol).split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

export function buildPriceHistory(symbol, days = 90) {
  const stock = loadStocks().find(s => s.symbol === symbol);
  if (!stock) return [];

  const seed = symbolSeed(symbol);
  const points = [];
  let price = stock.price * (0.88 + seededNoise(seed, 1) * 0.18);

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    const trend = (stock.rating - 70) / 10000;
    const wave = Math.sin((days - i) / 8 + seed) * 0.006;
    const noise = (seededNoise(seed, i) - 0.5) * 0.025;
    price = Math.max(1, price * (1 + trend + wave + noise));

    points.push({
      date: date.toISOString().slice(0, 10),
      price: Number(price.toFixed(2))
    });
  }

  const factor = stock.price / points[points.length - 1].price;
  return points.map(p => ({
    date: p.date,
    price: Number((p.price * factor).toFixed(2))
  }));
}

export function buildPortfolioHistory(stats, days = 90) {
  const holdings = stats.rows || [];
  const seriesBySymbol = {};
  holdings.forEach(h => {
    seriesBySymbol[h.symbol] = buildPriceHistory(h.symbol, days);
  });

  const points = [];
  for (let i = 0; i < days; i++) {
    let holdingsValue = 0;
    holdings.forEach(h => {
      const point = seriesBySymbol[h.symbol]?.[i];
      if (point) holdingsValue += Number(h.units) * point.price;
    });

    const date = holdings[0] ? seriesBySymbol[holdings[0].symbol][i].date : (() => {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      return d.toISOString().slice(0, 10);
    })();

    points.push({
      date,
      value: Number((Number(stats.account.cash_balance) + holdingsValue).toFixed(2))
    });
  }

  return points;
}

export function buildTradeMarkers(trades) {
  return (trades || []).map(t => ({
    date: String(t.created_at).slice(0, 10),
    symbol: t.symbol,
    action: t.action,
    units: Number(t.units),
    price: Number(t.price),
    label: `${t.action} ${Number(t.units)} ${t.symbol}`
  }));
}
