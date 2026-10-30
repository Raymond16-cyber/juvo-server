import { currencyDateKey, normalizeCurrencyCode } from "./currency.utils.js";

/**
 * Frankfurter daily reference-rate provider.
 * Docs: https://frankfurter.dev/ (v1 endpoints remain available)
 * Not a live executable FX feed.
 */
const FRANKFURTER_BASE =
  process.env.FRANKFURTER_API_BASE || "https://api.frankfurter.dev/v1";

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Frankfurter HTTP ${response.status}${text ? `: ${text.slice(0, 120)}` : ""}`,
      );
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function extractRate(payload, from, to) {
  if (!payload || typeof payload !== "object") return null;
  const rates = payload.rates || {};
  const direct = Number(rates[to]);
  if (Number.isFinite(direct) && direct > 0) {
    return {
      rate: direct,
      source: "frankfurter",
      rateDate: payload.date || null,
      providerBase: payload.base || from,
    };
  }
  return null;
}

class FrankfurterExchangeRateProvider {
  async getCurrentRate(from, to) {
    const normalizedFrom = normalizeCurrencyCode(from);
    const normalizedTo = normalizeCurrencyCode(to);
    if (!normalizedFrom || !normalizedTo) return null;

    try {
      const url = `${FRANKFURTER_BASE}/latest?base=${encodeURIComponent(normalizedFrom)}&symbols=${encodeURIComponent(normalizedTo)}`;
      const payload = await fetchJson(url);
      return extractRate(payload, normalizedFrom, normalizedTo);
    } catch (error) {
      console.warn(
        "Frankfurter current rate failed:",
        error?.message || error,
      );
      return null;
    }
  }

  async getHistoricalRate(from, to, date) {
    const normalizedFrom = normalizeCurrencyCode(from);
    const normalizedTo = normalizeCurrencyCode(to);
    if (!normalizedFrom || !normalizedTo) return null;

    const dateKey = currencyDateKey(date || new Date());
    try {
      const url = `${FRANKFURTER_BASE}/${encodeURIComponent(dateKey)}?base=${encodeURIComponent(normalizedFrom)}&symbols=${encodeURIComponent(normalizedTo)}`;
      const payload = await fetchJson(url);
      return extractRate(payload, normalizedFrom, normalizedTo);
    } catch (error) {
      // Weekends/holidays: fall back to latest reference rate and mark source.
      console.warn(
        "Frankfurter historical rate failed; trying latest:",
        error?.message || error,
      );
      const latest = await this.getCurrentRate(normalizedFrom, normalizedTo);
      if (!latest) return null;
      return {
        ...latest,
        source: "frankfurter-latest-fallback",
        requestedDate: dateKey,
      };
    }
  }
}

export { FrankfurterExchangeRateProvider, FRANKFURTER_BASE };
