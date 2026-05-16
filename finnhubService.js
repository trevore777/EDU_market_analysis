import "dotenv/config";
import { searchStocks } from "./appService.js";
import { getTwelveDataQuote, getLocalProfile } from "./twelveDataService.js";

function normaliseSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

// Kept with the same name so the rest of the app does not need changing.
// It now uses Twelve Data rather than Finnhub.
export async function getLiveQuote(symbol) {
  return getTwelveDataQuote(normaliseSymbol(symbol));
}

// Free Twelve Data does not provide a broad symbol search suitable for this app.
// Use the app's curated local stocks list, which is better for students anyway.
export async function searchLiveSymbols(query) {
  const q = String(query || "").trim();
  return {
    source: "local",
    results: searchStocks(q).slice(0, 30)
  };
}

// Kept for compatibility, but no paid API call is made.
export async function getCompanyProfile(symbol) {
  return getLocalProfile(normaliseSymbol(symbol));
}
