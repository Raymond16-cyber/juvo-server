import { getCachedRate, setCachedRate } from "./currency.cache.js";
import { ConfiguredExchangeRateProvider } from "./currency.provider.js";
import {
  currencyDateKey,
  normalizeCurrencyCode,
  roundMoney,
} from "./currency.utils.js";

class CurrencyConversionUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CurrencyConversionUnavailableError";
    this.code = "FX_RATE_UNAVAILABLE";
    this.details = details;
  }
}

class CurrencyService {
  constructor(provider = new ConfiguredExchangeRateProvider()) {
    this.provider = provider;
  }

  async getRate({ from, to, at, kind = "historical" }) {
    const normalizedFrom = normalizeCurrencyCode(from);
    const normalizedTo = normalizeCurrencyCode(to);

    if (!normalizedFrom || !normalizedTo) {
      throw new CurrencyConversionUnavailableError("Unsupported currency code.", {
        from,
        to,
      });
    }

    if (normalizedFrom === normalizedTo) {
      return {
        rate: 1,
        from: normalizedFrom,
        to: normalizedTo,
        rateAt: at ? new Date(at).toISOString() : new Date().toISOString(),
        source: "same-currency",
        kind,
      };
    }

    const dateKey = kind === "current" ? "current" : currencyDateKey(at);
    const cached = getCachedRate({
      from: normalizedFrom,
      to: normalizedTo,
      dateKey,
      kind,
    });
    if (cached) return cached;

    const rateResult =
      kind === "current"
        ? await this.provider.getCurrentRate(normalizedFrom, normalizedTo)
        : await this.provider.getHistoricalRate(normalizedFrom, normalizedTo, at);

    if (!rateResult?.rate) {
      throw new CurrencyConversionUnavailableError("FX rate unavailable.", {
        from: normalizedFrom,
        to: normalizedTo,
        at,
        kind,
      });
    }

    return setCachedRate(
      { from: normalizedFrom, to: normalizedTo, dateKey, kind },
      {
        rate: Number(rateResult.rate),
        from: normalizedFrom,
        to: normalizedTo,
        rateAt:
          kind === "current"
            ? new Date().toISOString()
            : new Date(at || Date.now()).toISOString(),
        source: rateResult.source || "provider",
        kind,
      },
    );
  }

  async convert({ amount, from, to, at, kind = "historical" }) {
    const rate = await this.getRate({ from, to, at, kind });
    return {
      amount: roundMoney(Number(amount || 0) * rate.rate),
      originalAmount: Number(amount || 0),
      ...rate,
    };
  }

  async convertClosedTrade({ amount, from, to, closedAt }) {
    return this.convert({
      amount,
      from,
      to,
      at: closedAt || new Date(),
      kind: "historical",
    });
  }

  async convertOpenPosition({ amount, from, to }) {
    return this.convert({
      amount,
      from,
      to,
      at: new Date(),
      kind: "current",
    });
  }
}

const currencyService = new CurrencyService();

export {
  CurrencyConversionUnavailableError,
  CurrencyService,
  currencyService,
};
