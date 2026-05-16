import { all, one, run } from "../db/db.js";
import { buyPaperTrade, sellPaperTrade, sandboxStats, searchStocks } from "./appService.js";
import { getCandles, getLiveQuote } from "./kunpengService.js";

function cleanSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function parseSymbols(input) {
  return String(input || "")
    .split(/[\n,]+/)
    .map(cleanSymbol)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, 20);
}

function movingAverage(values, window) {
  const nums = values.map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < window) return null;
  const slice = nums.slice(-window);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function numberOrDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function getStrategySettings(userId) {
  let settings = await one("SELECT * FROM auto_strategy_settings WHERE user_id = ?", [userId]);

  if (!settings) {
    const defaultSymbols = searchStocks("")
      .slice(0, 5)
      .map((s) => s.symbol)
      .join(",");

    await run(
      `INSERT INTO auto_strategy_settings
        (user_id, enabled, symbols, short_window, long_window, max_position_pct, stop_loss_pct, take_profit_pct)
       VALUES (?, 0, ?, 5, 20, 10, 5, 10)`,
      [userId, defaultSymbols]
    );

    settings = await one("SELECT * FROM auto_strategy_settings WHERE user_id = ?", [userId]);
  }

  return settings;
}

export async function saveStrategySettings(userId, body) {
  const enabled = body.enabled ? 1 : 0;
  const symbols = parseSymbols(body.symbols).join(",");
  const shortWindow = Math.max(2, Math.round(numberOrDefault(body.short_window, 5)));
  const longWindow = Math.max(shortWindow + 1, Math.round(numberOrDefault(body.long_window, 20)));
  const maxPositionPct = Math.min(50, Math.max(1, numberOrDefault(body.max_position_pct, 10)));
  const stopLossPct = Math.min(50, Math.max(1, numberOrDefault(body.stop_loss_pct, 5)));
  const takeProfitPct = Math.min(100, Math.max(1, numberOrDefault(body.take_profit_pct, 10)));

  await getStrategySettings(userId);
  await run(
    `UPDATE auto_strategy_settings
     SET enabled = ?, symbols = ?, short_window = ?, long_window = ?, max_position_pct = ?,
         stop_loss_pct = ?, take_profit_pct = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [enabled, symbols, shortWindow, longWindow, maxPositionPct, stopLossPct, takeProfitPct, userId]
  );

  return getStrategySettings(userId);
}

async function getCurrentPrice(symbol, fallbackPrice) {
  try {
    const quote = await getLiveQuote(symbol);
    const price = Number(quote?.quote?.c);
    if (Number.isFinite(price) && price > 0) return price;
  } catch (err) {
    // Keep the strategy usable in sandbox mode when live data is unavailable.
  }

  return Number(fallbackPrice || 0);
}

async function analyseSymbol(symbol, settings, stats) {
  const candles = await getCandles(symbol, Math.max(90, Number(settings.long_window) + 10));
  const closes = (candles?.points || [])
    .map((p) => Number(p.close ?? p.price))
    .filter((n) => Number.isFinite(n) && n > 0);

  const latestFallback = closes.at(-1) || 0;
  const price = await getCurrentPrice(symbol, latestFallback);
  const shortMa = movingAverage(closes, Number(settings.short_window));
  const longMa = movingAverage(closes, Number(settings.long_window));
  const holding = stats.rows.find((row) => cleanSymbol(row.symbol) === symbol);

  if (!shortMa || !longMa || !price) {
    return {
      symbol,
      action: "HOLD",
      price,
      shortMa: shortMa || 0,
      longMa: longMa || 0,
      reason: "Not enough price history to make a rule-based decision.",
      holding
    };
  }

  if (holding) {
    const gainPct = Number(holding.gainPct || 0);
    if (gainPct <= -Number(settings.stop_loss_pct)) {
      return { symbol, action: "SELL", price, shortMa, longMa, reason: `Stop-loss triggered at ${gainPct.toFixed(2)}%.`, holding };
    }
    if (gainPct >= Number(settings.take_profit_pct)) {
      return { symbol, action: "SELL", price, shortMa, longMa, reason: `Take-profit triggered at ${gainPct.toFixed(2)}%.`, holding };
    }
    if (shortMa < longMa) {
      return { symbol, action: "SELL", price, shortMa, longMa, reason: `${settings.short_window}-day average is below ${settings.long_window}-day average.`, holding };
    }
    return { symbol, action: "HOLD", price, shortMa, longMa, reason: "Already holding and trend rule remains positive.", holding };
  }

  if (shortMa > longMa) {
    return { symbol, action: "BUY", price, shortMa, longMa, reason: `${settings.short_window}-day average is above ${settings.long_window}-day average.`, holding: null };
  }

  return { symbol, action: "HOLD", price, shortMa, longMa, reason: "Trend rule is not positive enough to buy.", holding: null };
}

async function recordSignal(userId, runId, signal, executed = false) {
  await run(
    `INSERT INTO auto_strategy_signals
      (user_id, run_id, symbol, action, price, short_ma, long_ma, reason, executed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      runId,
      signal.symbol,
      signal.action,
      Number(signal.price || 0),
      Number(signal.shortMa || 0),
      Number(signal.longMa || 0),
      signal.reason || "",
      executed ? 1 : 0
    ]
  );
}

export async function runAutoStrategy(userId, { execute = false } = {}) {
  const settings = await getStrategySettings(userId);
  const symbols = parseSymbols(settings.symbols);
  const stats = await sandboxStats(userId);

  const runResult = await run(
    "INSERT INTO auto_strategy_runs (user_id, status, summary) VALUES (?, ?, ?)",
    [userId, execute ? "executed" : "analysis", "Running strategy"]
  );

  const runId = Number(runResult.lastInsertRowid);
  const signals = [];
  let executedCount = 0;

  for (const symbol of symbols) {
    const signal = await analyseSymbol(symbol, settings, await sandboxStats(userId));
    let executed = false;

    if (execute && settings.enabled) {
      if (signal.action === "BUY" && signal.price > 0) {
        const currentStats = await sandboxStats(userId);
        const maxTradeValue = currentStats.totalValue * (Number(settings.max_position_pct) / 100);
        const availableTradeValue = Math.min(Number(currentStats.account.cash_balance), maxTradeValue);
        const units = Math.floor((availableTradeValue / signal.price) * 10000) / 10000;

        if (units > 0) {
          await buyPaperTrade(userId, symbol, units, `Auto Strategy Lab: ${signal.reason}`, signal.price);
          executed = true;
        } else {
          signal.reason += " Not enough virtual cash to buy within risk limit.";
        }
      }

      if (signal.action === "SELL" && signal.holding && Number(signal.holding.units) > 0) {
        await sellPaperTrade(userId, symbol, Number(signal.holding.units), `Auto Strategy Lab: ${signal.reason}`, signal.price);
        executed = true;
      }
    }

    if (executed) executedCount += 1;
    await recordSignal(userId, runId, signal, executed);
    signals.push({ ...signal, executed });
  }

  const summary = `${signals.length} symbols checked. ${executedCount} sandbox trade${executedCount === 1 ? "" : "s"} executed.`;
  await run("UPDATE auto_strategy_runs SET summary = ? WHERE id = ?", [summary, runId]);

  return { runId, summary, settings, signals, executedCount };
}

export async function getStrategyDashboard(userId) {
  const settings = await getStrategySettings(userId);
  const recentRuns = await all("SELECT * FROM auto_strategy_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10", [userId]);
  const recentSignals = await all("SELECT * FROM auto_strategy_signals WHERE user_id = ? ORDER BY created_at DESC LIMIT 25", [userId]);
  return { settings, recentRuns, recentSignals, symbols: parseSymbols(settings.symbols) };
}
