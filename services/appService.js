
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

export function findStock(symbol) {
  return loadStocks().find(s => s.symbol.toUpperCase() === String(symbol || "").toUpperCase());
}

export function searchStocks(query = "") {
  const q = String(query || "").trim().toLowerCase();
  const stocks = loadStocks();
  if (!q) return stocks.sort((a,b)=>b.rating-a.rating);
  return stocks.filter(s => {
    const hay = `${s.symbol} ${s.name} ${s.type} ${s.sector}`.toLowerCase();
    return hay.includes(q);
  }).sort((a,b)=>b.rating-a.rating);
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

function stockStrengths(stock) {
  const strengths = [];
  if (stock.quality >= 85) strengths.push("high quality score");
  if (stock.value >= 70) strengths.push("reasonable value score");
  if (stock.momentum >= 75) strengths.push("positive momentum");
  if (stock.income >= 70) strengths.push("stronger dividend/income profile");
  if (stock.type === "ETF") strengths.push("built-in diversification");
  return strengths.length ? strengths : ["mixed profile; needs more research"];
}

function stockRisks(stock) {
  const risks = [];
  if (stock.risk.includes("High")) risks.push("higher volatility");
  if (stock.value < 55) risks.push("valuation may be stretched");
  if (stock.income < 20) risks.push("limited income/dividends");
  if (stock.sector.toLowerCase().includes("technology")) risks.push("technology concentration and valuation risk");
  if (stock.sector.toLowerCase().includes("bank")) risks.push("interest rate, property and credit-cycle risk");
  return risks.length ? risks : ["normal market risk"];
}

export function buildGuidedAnswer({ promptId, symbol, compareSymbol, customQuestion, stats }) {
  const stock = findStock(symbol);
  const compare = compareSymbol ? findStock(compareSymbol) : null;
  const prompts = loadPrompts();
  const prompt = prompts.find(p => p.id === promptId);

  if (!stock && !customQuestion) {
    return {
      title: "Choose a share first",
      summary: "Select a share or ETF and a guided question.",
      points: ["Use Search to find a share, then choose a prompt from the dropdown."]
    };
  }

  if (promptId === "compare" && stock && compare) {
    return {
      title: `Compare ${stock.symbol} and ${compare.symbol}`,
      summary: `${stock.symbol} is ${stock.type} exposure to ${stock.sector}. ${compare.symbol} is ${compare.type} exposure to ${compare.sector}.`,
      points: [
        `${stock.symbol} rating: ${stock.rating}/100. ${compare.symbol} rating: ${compare.rating}/100.`,
        `${stock.symbol} risk: ${stock.risk}. ${compare.symbol} risk: ${compare.risk}.`,
        `${stock.symbol} strengths: ${stockStrengths(stock).join(", ")}.`,
        `${compare.symbol} strengths: ${stockStrengths(compare).join(", ")}.`,
        "For a beginner, broad diversification and understanding the risk usually matter more than chasing the highest short-term return."
      ]
    };
  }

  if (stock) {
    if (promptId === "risks") {
      return {
        title: `Risks of ${stock.symbol}`,
        summary: stock.summary,
        points: stockRisks(stock).map(r => `Risk: ${r}.`).concat([
          "A beginner should ask: would I still be comfortable holding this if it dropped 20%?"
        ])
      };
    }
    if (promptId === "valuation") {
      return {
        title: `Value check: ${stock.symbol}`,
        summary: `${stock.symbol} has a value score of ${stock.value}/100 and a quality score of ${stock.quality}/100 in this prototype model.`,
        points: [
          stock.value >= 70 ? "The model does not flag valuation as a major concern." : "The model suggests valuation caution.",
          stock.quality >= 85 ? "Quality appears strong." : "Quality is more mixed.",
          "A good company can still be a poor investment if bought at too high a price.",
          "This is an educational model, not personal financial advice."
        ]
      };
    }
    if (promptId === "diversification") {
      const sectorExposure = stats?.sectors?.[stock.sector] || 0;
      return {
        title: `Diversification check: ${stock.symbol}`,
        summary: `${stock.symbol} belongs to ${stock.sector}.`,
        points: [
          sectorExposure > 0 ? `You already have virtual exposure to ${stock.sector}.` : `This would add new virtual exposure to ${stock.sector}.`,
          stock.type === "ETF" ? "Because this is an ETF, it usually provides more diversification than one individual company." : "Because this is one company, it adds company-specific risk.",
          "Avoid putting too much of the portfolio into one sector or one company."
        ]
      };
    }
    if (promptId === "income_growth") {
      return {
        title: `Growth vs income: ${stock.symbol}`,
        summary: `${stock.symbol} has an income score of ${stock.income}/100 and momentum score of ${stock.momentum}/100.`,
        points: [
          stock.income >= 70 ? "This may appeal more to income/dividend-focused investors." : "This is not primarily an income idea in this model.",
          stock.momentum >= 75 ? "Momentum is relatively positive." : "Momentum is not a major strength.",
          "Growth investors usually focus on future earnings expansion. Income investors usually focus on dividends and stability."
        ]
      };
    }
    if (promptId === "buy_later") {
      return {
        title: `What would make ${stock.symbol} more attractive later?`,
        summary: stock.summary,
        points: [
          "A better valuation or lower price zone.",
          "Improved earnings, dividends, or business momentum.",
          "Reduced concentration risk in your portfolio.",
          "A clearer reason for owning it beyond recent price movement."
        ]
      };
    }

    return {
      title: `Explain ${stock.symbol} simply`,
      summary: stock.summary,
      points: [
        `${stock.name} is a ${stock.type} in ${stock.sector}.`,
        `Prototype rating: ${stock.rating}/100.`,
        `Main strengths: ${stockStrengths(stock).join(", ")}.`,
        `Main risks: ${stockRisks(stock).join(", ")}.`,
        "Use this as learning support before making any real financial decision."
      ]
    };
  }

  return {
    title: "AI learning response",
    summary: customQuestion || "Ask a question about shares, ETFs, risk or diversification.",
    points: [
      "Use the guided dropdowns to ask better investing questions.",
      "Good questions focus on risk, valuation, diversification, income, growth and time horizon.",
      "The app is educational and sandbox-only."
    ]
  };
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
  return buildGuidedAnswer({ customQuestion: question, stats });
}
