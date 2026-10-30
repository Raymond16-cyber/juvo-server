/**
 * Instrument specification registry for position sizing.
 * Only includes explicit, documented conventions. Unknown symbols fall back
 * to manual quantity entry instead of inventing contract sizes.
 */

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const FOREX_MAJORS = new Set([
  "EURUSD",
  "GBPUSD",
  "AUDUSD",
  "NZDUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
  "EURGBP",
  "EURJPY",
  "GBPJPY",
  "AUDJPY",
  "EURCHF",
  "EURAUD",
  "GBPAUD",
  "GBPCAD",
  "AUDCAD",
  "AUDNZD",
  "CADJPY",
  "CHFJPY",
  "EURNZD",
  "GBPNZD",
  "NZDJPY",
  "AUDCHF",
  "CADCHF",
  "NZDCHF",
  "EURCAD",
  "NZDCAD",
]);

const METAL_SPECS = {
  XAUUSD: {
    assetClass: "commodities",
    contractSize: 100,
    quoteCurrency: "USD",
    volumeStep: 0.01,
    minVolume: 0.01,
    pipSize: 0.01,
    confidence: "approximate",
    note: "Standard XAUUSD contract size assumed (100 oz). Confirm with your broker.",
  },
  XAGUSD: {
    assetClass: "commodities",
    contractSize: 5000,
    quoteCurrency: "USD",
    volumeStep: 0.01,
    minVolume: 0.01,
    pipSize: 0.001,
    confidence: "approximate",
    note: "Standard XAGUSD contract size assumed (5000 oz). Confirm with your broker.",
  },
};

function inferForexPair(symbol) {
  const clean = normalizeSymbol(symbol);
  if (clean.length !== 6) return null;
  const base = clean.slice(0, 3);
  const quote = clean.slice(3, 6);
  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) return null;
  return { base, quote, symbol: clean };
}

function resolveInstrumentSpec({ symbol, instrument }) {
  const clean = normalizeSymbol(symbol);
  const assetClass = String(instrument || "").toLowerCase();

  if (METAL_SPECS[clean]) {
    return {
      symbol: clean,
      ...METAL_SPECS[clean],
      known: true,
    };
  }

  if (assetClass === "forex" || FOREX_MAJORS.has(clean) || inferForexPair(clean)) {
    const pair = inferForexPair(clean);
    if (!pair) {
      return {
        symbol: clean,
        assetClass: "forex",
        known: false,
        confidence: "unavailable",
        note: "Unable to parse forex pair. Enter position size manually.",
      };
    }

    const isJpy = pair.quote === "JPY" || pair.base === "JPY";
    return {
      symbol: pair.symbol,
      assetClass: "forex",
      known: true,
      confidence: FOREX_MAJORS.has(pair.symbol) ? "high" : "approximate",
      contractSize: 100000,
      quoteCurrency: pair.quote,
      baseCurrency: pair.base,
      volumeStep: 0.01,
      minVolume: 0.01,
      pipSize: isJpy ? 0.01 : 0.0001,
      note: FOREX_MAJORS.has(pair.symbol)
        ? "Standard forex lot (100,000 units)."
        : "Assumed standard forex lot (100,000 units). Confirm with your broker.",
    };
  }

  if (assetClass === "stocks") {
    return {
      symbol: clean,
      assetClass: "stocks",
      known: true,
      confidence: "approximate",
      contractSize: 1,
      quoteCurrency: null,
      volumeStep: 1,
      minVolume: 1,
      pipSize: 0.01,
      note: "Stock sizing uses share quantity. Quote currency assumed to match account unless converted.",
    };
  }

  if (assetClass === "crypto") {
    return {
      symbol: clean,
      assetClass: "crypto",
      known: true,
      confidence: "approximate",
      contractSize: 1,
      quoteCurrency: clean.endsWith("USD")
        ? "USD"
        : clean.endsWith("USDT")
          ? "USD"
          : null,
      volumeStep: 0.001,
      minVolume: 0.001,
      pipSize: 0.01,
      note: "Crypto sizing uses coin units with an assumed contract size of 1. Confirm with your broker.",
    };
  }

  return {
    symbol: clean,
    assetClass: assetClass || "others",
    known: false,
    confidence: "unavailable",
    note:
      "No verified contract specification for this instrument. Enter position size manually.",
  };
}

export { inferForexPair, normalizeSymbol, resolveInstrumentSpec };
