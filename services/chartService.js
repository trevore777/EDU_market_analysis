
import { loadStocks } from "./appService.js";

export function buildPriceHistory(symbol, days = 90) {
  const stock = loadStocks().find(s => s.symbol === symbol) || { price: 100, rating: 70 };
  const points = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const wave = Math.sin((days - i) / 8) * 0.05;
    const trend = ((stock.rating || 70) - 70) / 1000;
    const price = stock.price * (1 - 0.08 + ((days - i) / days) * 0.08 + wave + trend);
    points.push({ date: d.toISOString().slice(0, 10), price: Number(price.toFixed(2)) });
  }

  return points;
}

export function buildPortfolioHistory(stats, days = 90) {
  const points = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const wave = Math.sin((days - i) / 10) * 0.03;
    const value = stats.totalValue * (1 - 0.05 + ((days - i) / days) * 0.05 + wave);
    points.push({ date: d.toISOString().slice(0, 10), value: Number(value.toFixed(2)) });
  }

  return points;
}

export function buildTradeMarkers(trades) {
  return (trades || []).map(t => ({ date: String(t.created_at).slice(0,10), action: t.action, symbol: t.symbol }));
}
