import { currencyDateKey, normalizeCurrencyCode } from "./currency.utils.js";

function parseRateConfig() {
  const raw = process.env.FX_RATES_JSON;
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function readConfiguredRate({ from, to, dateKey, kind }) {
  const rates = parseRateConfig();
  const pair = `${from}_${to}`;
  const reversePair = `${to}_${from}`;
  const pairRates = rates[pair];
  const reverseRates = rates[reversePair];

  const direct =
    typeof pairRates === "number"
      ? pairRates
      : pairRates?.[dateKey] ?? pairRates?.current ?? pairRates?.default;

  if (Number.isFinite(Number(direct)) && Number(direct) > 0) {
    return {
      rate: Number(direct),
      source: "configured",
      kind,
    };
  }

  const reverse =
    typeof reverseRates === "number"
      ? reverseRates
      : reverseRates?.[dateKey] ?? reverseRates?.current ?? reverseRates?.default;

  if (Number.isFinite(Number(reverse)) && Number(reverse) > 0) {
    return {
      rate: 1 / Number(reverse),
      source: "configured-reverse",
      kind,
    };
  }

  return null;
}

class ConfiguredExchangeRateProvider {
  async getCurrentRate(from, to) {
    const normalizedFrom = normalizeCurrencyCode(from);
    const normalizedTo = normalizeCurrencyCode(to);
    if (!normalizedFrom || !normalizedTo) return null;

    return readConfiguredRate({
      from: normalizedFrom,
      to: normalizedTo,
      dateKey: "current",
      kind: "current",
    });
  }

  async getHistoricalRate(from, to, date) {
    const normalizedFrom = normalizeCurrencyCode(from);
    const normalizedTo = normalizeCurrencyCode(to);
    if (!normalizedFrom || !normalizedTo) return null;

    return readConfiguredRate({
      from: normalizedFrom,
      to: normalizedTo,
      dateKey: currencyDateKey(date),
      kind: "historical",
    });
  }
}

export { ConfiguredExchangeRateProvider };
