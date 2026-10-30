import { ConfiguredExchangeRateProvider } from "./currency.provider.js";
import { FrankfurterExchangeRateProvider } from "./frankfurter.provider.js";

/**
 * Prefer Frankfurter daily reference rates, then configured FX_RATES_JSON.
 */
class CompositeExchangeRateProvider {
  constructor({
    frankfurter = new FrankfurterExchangeRateProvider(),
    configured = new ConfiguredExchangeRateProvider(),
  } = {}) {
    this.frankfurter = frankfurter;
    this.configured = configured;
  }

  async getCurrentRate(from, to) {
    const primary = await this.frankfurter.getCurrentRate(from, to);
    if (primary?.rate) return primary;
    return this.configured.getCurrentRate(from, to);
  }

  async getHistoricalRate(from, to, date) {
    const primary = await this.frankfurter.getHistoricalRate(from, to, date);
    if (primary?.rate) return primary;
    return this.configured.getHistoricalRate(from, to, date);
  }
}

export { CompositeExchangeRateProvider };
