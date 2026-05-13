
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { all, one, run } from "../db/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadStocks() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "stocks.json"), "utf8"));
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

export async function getWatchlist(userId) {
  return all("SELECT * FROM watchlist WHERE user_id = ? ORDER BY created_at DESC", [userId]);
}

export async function sandboxStats(userId) {
  const stocks = loadStocks();
  const account = await ensurePaperAccount(userId);
  const holdings = await all("SELECT * FROM paper_holdings WHERE user_id = ? AND units > 0 ORDER BY symbol", [userId]);
  const trades = await all("SELECT * FROM paper_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [userId]);

  const rows = holdings.map(h => {
    const stock = stocks.find(s => s.symbol === h.symbol);
    if (!stock) return null;
    const units = Number(h.units);
    const avgPrice = Number(h.avg_price);
    const value = units * stock.price;
    const cost = units * avgPrice;
    return { ...h, units, avg_price: avgPrice, stock, value, cost, gain: value - cost, gainPct: cost ? ((value - cost) / cost) * 100 : 0 };
  }).filter(Boolean);

  const cashBalance = Number(account.cash_balance);
  const startingCash = Number(account.starting_cash);
  const holdingsValue = rows.reduce((sum, r) => sum + r.value, 0);
  const totalValue = cashBalance + holdingsValue;
  const totalGain = totalValue - startingCash;
  const totalGainPct = startingCash ? (totalGain / startingCash) * 100 : 0;

  const sectors = {};
  rows.forEach(r => sectors[r.stock.sector] = (sectors[r.stock.sector] || 0) + r.value);
  const largestSector = Object.entries(sectors).sort((a,b)=>b[1]-a[1])[0] || ["None", 0];
  const concentrationRisk = holdingsValue ? (largestSector[1] / holdingsValue) * 100 : 0;
  const avgRating = rows.length ? rows.reduce((sum, r) => sum + r.stock.rating, 0) / rows.length : 0;
  const healthScore = rows.length ? Math.round(Math.max(0, Math.min(100, avgRating - Math.max(0, concentrationRisk - 50) * 0.4))) : 0;

  return { account: { ...account, cash_balance: cashBalance, starting_cash: startingCash }, rows, trades, holdingsValue, totalValue, totalGain, totalGainPct, sectors, largestSector, concentrationRisk, avgRating, healthScore };
}

export async function buyPaperTrade(userId, symbol, units, reason = "") {
  const stock = findStock(symbol);
  if (!stock) throw new Error("Stock not found.");
  if (!Number.isFinite(units) || units <= 0) throw new Error("Units must be greater than zero.");

  const account = await ensurePaperAccount(userId);
  const cashBalance = Number(account.cash_balance);
  const total = units * stock.price;
  if (total > cashBalance) throw new Error("Not enough virtual cash.");

  const existing = await one("SELECT * FROM paper_holdings WHERE user_id = ? AND symbol = ?", [userId, stock.symbol]);
  if (existing) {
    const existingUnits = Number(existing.units);
    const existingAvg = Number(existing.avg_price);
    const newUnits = existingUnits + units;
    const newAvg = ((existingUnits * existingAvg) + total) / newUnits;
    await run("UPDATE paper_holdings SET units = ?, avg_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [newUnits, newAvg, existing.id]);
  } else {
    await run("INSERT INTO paper_holdings (user_id, symbol, units, avg_price) VALUES (?, ?, ?, ?)", [userId, stock.symbol, units, stock.price]);
  }

  await run("UPDATE paper_accounts SET cash_balance = cash_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [total, userId]);
  await run("INSERT INTO paper_trades (user_id, symbol, action, units, price, total_value, reason) VALUES (?, ?, 'BUY', ?, ?, ?, ?)", [userId, stock.symbol, units, stock.price, total, reason]);
}

export async function sellPaperTrade(userId, symbol, units, reason = "") {
  const stock = findStock(symbol);
  if (!stock) throw new Error("Stock not found.");
  if (!Number.isFinite(units) || units <= 0) throw new Error("Units must be greater than zero.");

  const holding = await one("SELECT * FROM paper_holdings WHERE user_id = ? AND symbol = ?", [userId, stock.symbol]);
  if (!holding || Number(holding.units) < units) throw new Error("Not enough virtual units to sell.");

  const total = units * stock.price;
  const newUnits = Number(holding.units) - units;
  if (newUnits <= 0.000001) {
    await run("DELETE FROM paper_holdings WHERE id = ?", [holding.id]);
  } else {
    await run("UPDATE paper_holdings SET units = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [newUnits, holding.id]);
  }

  await run("UPDATE paper_accounts SET cash_balance = cash_balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [total, userId]);
  await run("INSERT INTO paper_trades (user_id, symbol, action, units, price, total_value, reason) VALUES (?, ?, 'SELL', ?, ?, ?, ?)", [userId, stock.symbol, units, stock.price, total, reason]);
}

export async function resetSandbox(userId) {
  await run("DELETE FROM paper_trades WHERE user_id = ?", [userId]);
  await run("DELETE FROM paper_holdings WHERE user_id = ?", [userId]);
  await run("UPDATE paper_accounts SET starting_cash = 10000, cash_balance = 10000, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [userId]);
}

export function coachResponse(question, stats) {
  const q = String(question || "").toLowerCase();
  if (q.includes("portfolio") || q.includes("sandbox")) {
    const riskLine = stats.concentrationRisk > 60
      ? `Your largest sector is ${stats.largestSector[0]} at ${stats.concentrationRisk.toFixed(1)}%, which is concentrated.`
      : "Your current sector concentration is not heavily flagged by the sandbox model.";
    return {
      title: "Sandbox portfolio review",
      summary: `Your virtual portfolio is worth $${stats.totalValue.toFixed(2)}, with a total return of ${stats.totalGainPct.toFixed(2)}%.`,
      points: [
        `Virtual cash available: $${stats.account.cash_balance.toFixed(2)}.`,
        `Virtual holdings value: $${stats.holdingsValue.toFixed(2)}.`,
        `Sandbox health score: ${stats.healthScore}/100.`,
        riskLine,
        "Use fake trades to test your decision-making before considering real money."
      ]
    };
  }
  return {
    title: "Paper trading coach",
    summary: "Use the sandbox to practise buying and selling with fake money.",
    points: [
      "Write a reason before each fake trade.",
      "Review whether your reason was based on quality, valuation, diversification or emotion.",
      "Avoid putting all virtual cash into one share just because it recently moved up.",
      "This is a simulation only and does not place real trades."
    ]
  };
}
