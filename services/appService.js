
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { all, one, run } from "../db/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadStocks() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "stocks.json"), "utf8"));
}

export function loadPrompts() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "ai-prompts.json"), "utf8"));
}

export function searchStocks(q = "") {
  q = String(q || "").toLowerCase().trim();
  const stocks = loadStocks();
  if (!q) return stocks.sort((a,b)=>b.rating-a.rating);
  return stocks.filter(s => `${s.symbol} ${s.name} ${s.sector} ${s.type}`.toLowerCase().includes(q)).sort((a,b)=>b.rating-a.rating);
}

export function findStock(symbol) {
  return loadStocks().find(s => s.symbol.toUpperCase() === String(symbol || "").toUpperCase());
}

export async function ensurePaperAccount(userId) {
  let account = await one("SELECT * FROM paper_accounts WHERE user_id = ?", [userId]);
  if (!account) {
    await run("INSERT INTO paper_accounts (user_id, starting_cash, cash_balance) VALUES (?, ?, ?)", [userId, 10000, 10000]);
    account = await one("SELECT * FROM paper_accounts WHERE user_id = ?", [userId]);
  }
  return account;
}

export async function sandboxStats(userId) {
  const stocks = loadStocks();
  const account = await ensurePaperAccount(userId);
  const holdings = await all("SELECT * FROM paper_holdings WHERE user_id = ? AND units > 0 ORDER BY symbol", [userId]);
  const trades = await all("SELECT * FROM paper_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [userId]);

  const rows = holdings.map(h => {
    const stock = stocks.find(s => s.symbol === h.symbol) || {
      symbol: h.symbol,
      name: h.symbol,
      sector: "Live / External",
      price: Number(h.avg_price),
      rating: 0,
      risk: "Unknown"
    };

    const value = Number(h.units) * stock.price;
    const cost = Number(h.units) * Number(h.avg_price);

    return { ...h, stock, value, cost, gain: value - cost, gainPct: cost ? ((value - cost) / cost) * 100 : 0 };
  }).filter(Boolean);

  const holdingsValue = rows.reduce((s, r) => s + r.value, 0);
  const totalValue = Number(account.cash_balance) + holdingsValue;
  const totalGain = totalValue - Number(account.starting_cash);
  const totalGainPct = Number(account.starting_cash) ? (totalGain / Number(account.starting_cash)) * 100 : 0;

  const avgRating = rows.length ? rows.reduce((sum, r) => sum + Number(r.stock.rating || 0), 0) / rows.length : 0;
  const healthScore = rows.length ? Math.round(Math.max(0, Math.min(100, avgRating || 65))) : 0;

  return { account, rows, trades, holdingsValue, totalValue, totalGain, totalGainPct, avgRating, healthScore };
}

export async function buyPaperTrade(userId, symbol, units, reason = "", priceOverride = null) {
  const localStock = findStock(symbol);
  const price = Number(priceOverride || localStock?.price);
  if (!price || !Number.isFinite(price)) throw new Error("Could not determine trade price.");
  if (!Number.isFinite(units) || units <= 0) throw new Error("Units must be greater than zero.");

  const stockSymbol = String(symbol).toUpperCase();
  const account = await ensurePaperAccount(userId);
  const total = units * price;

  if (total > Number(account.cash_balance)) throw new Error("Not enough virtual cash.");

  const existing = await one("SELECT * FROM paper_holdings WHERE user_id = ? AND symbol = ?", [userId, stockSymbol]);

  if (existing) {
    const newUnits = Number(existing.units) + units;
    const newAvg = ((Number(existing.units) * Number(existing.avg_price)) + total) / newUnits;
    await run("UPDATE paper_holdings SET units = ?, avg_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [newUnits, newAvg, existing.id]);
  } else {
    await run("INSERT INTO paper_holdings (user_id, symbol, units, avg_price) VALUES (?, ?, ?, ?)", [userId, stockSymbol, units, price]);
  }

  await run("UPDATE paper_accounts SET cash_balance = cash_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [total, userId]);
  await run("INSERT INTO paper_trades (user_id, symbol, action, units, price, total_value, reason) VALUES (?, ?, 'BUY', ?, ?, ?, ?)", [userId, stockSymbol, units, price, total, reason]);
}

export async function sellPaperTrade(userId, symbol, units, reason = "", priceOverride = null) {
  const localStock = findStock(symbol);
  const price = Number(priceOverride || localStock?.price);
  if (!price || !Number.isFinite(price)) throw new Error("Could not determine trade price.");
  if (!Number.isFinite(units) || units <= 0) throw new Error("Units must be greater than zero.");

  const stockSymbol = String(symbol).toUpperCase();
  const holding = await one("SELECT * FROM paper_holdings WHERE user_id = ? AND symbol = ?", [userId, stockSymbol]);

  if (!holding || Number(holding.units) < units) throw new Error("Not enough virtual units to sell.");

  const total = units * price;
  const newUnits = Number(holding.units) - units;

  if (newUnits <= 0.000001) await run("DELETE FROM paper_holdings WHERE id = ?", [holding.id]);
  else await run("UPDATE paper_holdings SET units = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [newUnits, holding.id]);

  await run("UPDATE paper_accounts SET cash_balance = cash_balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [total, userId]);
  await run("INSERT INTO paper_trades (user_id, symbol, action, units, price, total_value, reason) VALUES (?, ?, 'SELL', ?, ?, ?, ?)", [userId, stockSymbol, units, price, total, reason]);
}

export async function resetSandbox(userId) {
  await run("DELETE FROM paper_trades WHERE user_id = ?", [userId]);
  await run("DELETE FROM paper_holdings WHERE user_id = ?", [userId]);
  await run("UPDATE paper_accounts SET cash_balance = 10000, starting_cash = 10000, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [userId]);
}

export function buildGuidedAnswer({ promptId, symbol, compareSymbol, liveQuote }) {
  const stock = findStock(symbol) || {
    symbol,
    name: symbol,
    type: "Live Search",
    sector: "External",
    rating: 0,
    risk: "Unknown",
    signal: "Research",
    summary: "Live searched symbol. Use external data and your own research."
  };

  const compare = findStock(compareSymbol);

  if (promptId === "compare" && compare) {
    return {
      title: `Compare ${stock.symbol} and ${compare.symbol}`,
      summary: `${stock.symbol} is in ${stock.sector}. ${compare.symbol} is in ${compare.sector}.`,
      points: [
        `${stock.symbol} rating: ${stock.rating || "N/A"}/100.`,
        `${compare.symbol} rating: ${compare.rating}/100.`,
        `${stock.symbol} risk: ${stock.risk}.`,
        `${compare.symbol} risk: ${compare.risk}.`,
        "For beginners, diversification and risk usually matter more than chasing short-term returns."
      ]
    };
  }

  if (promptId === "live_movement") {
    if (!liveQuote?.quote) return { title: `Live quote for ${stock.symbol}`, summary: "No live quote available.", points: ["Check Finnhub API key or API limits."] };

    const q = liveQuote.quote;
    const change = q.pc ? ((q.c - q.pc) / q.pc) * 100 : 0;

    return {
      title: `Live quote check: ${stock.symbol}`,
      summary: `Current price: $${Number(q.c).toFixed(2)}. Previous close: $${Number(q.pc || 0).toFixed(2)}.`,
      points: [
        `Daily change: ${change >= 0 ? "+" : ""}${change.toFixed(2)}%.`,
        `Day high: $${Number(q.h || 0).toFixed(2)}. Day low: $${Number(q.l || 0).toFixed(2)}.`,
        "A single daily move is not enough to decide whether something is a good investment.",
        "Use live price data together with risk, valuation, diversification and your time horizon."
      ]
    };
  }

  const pointsByPrompt = {
    explain_simple: [`${stock.name} is a ${stock.type} in ${stock.sector}.`, stock.summary, `Prototype signal: ${stock.signal}.`],
    risks: [`Risk level: ${stock.risk}.`, "Think about volatility, concentration risk, valuation risk and whether you understand the business."],
    valuation: [`Rating: ${stock.rating || "N/A"}/100.`, "A good company can still be expensive. This prototype uses a simple rating model only."],
    diversification: [`Sector: ${stock.sector}.`, stock.type === "ETF" ? "ETFs usually diversify better than single companies." : "Single companies add company-specific risk."],
    income_growth: [stock.type === "ETF" ? "This may suit broad long-term exposure." : "Check whether this suits growth, income or speculative goals."]
  };

  return {
    title: `${stock.symbol}: Guided AI explanation`,
    summary: stock.summary,
    points: pointsByPrompt[promptId] || pointsByPrompt.explain_simple
  };
}

export function coachResponse(question, stats) {
  return {
    title: "Sandbox coach",
    summary: `Your virtual portfolio is worth $${stats.totalValue.toFixed(2)}.`,
    points: [
      `Virtual cash: $${Number(stats.account.cash_balance).toFixed(2)}.`,
      `Holdings value: $${stats.holdingsValue.toFixed(2)}.`,
      "Use Live Search + AI for guided share questions."
    ]
  };
}
