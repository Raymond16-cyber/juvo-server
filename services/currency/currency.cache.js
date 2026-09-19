const rateCache = new Map();

function cacheKey({ from, to, dateKey, kind }) {
  return `${kind}:${from}:${to}:${dateKey || "current"}`;
}

function getCachedRate(input) {
  return rateCache.get(cacheKey(input)) || null;
}

function setCachedRate(input, value) {
  rateCache.set(cacheKey(input), value);
  return value;
}

function clearCurrencyRateCache() {
  rateCache.clear();
}

export { clearCurrencyRateCache, getCachedRate, setCachedRate };
