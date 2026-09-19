import assert from "node:assert/strict";
import test from "node:test";
import {
  CurrencyConversionUnavailableError,
  CurrencyService,
} from "../services/currency/currency.service.js";
import { clearCurrencyRateCache } from "../services/currency/currency.cache.js";

class TestRateProvider {
  constructor() {
    this.calls = 0;
  }

  async getCurrentRate(from, to) {
    this.calls += 1;
    if (from === "EUR" && to === "USD") {
      return { rate: 1.2, source: "test-current" };
    }
    return null;
  }

  async getHistoricalRate(from, to, at) {
    this.calls += 1;
    const dateKey = new Date(at).toISOString().slice(0, 10);
    if (from === "EUR" && to === "USD" && dateKey === "2026-09-08") {
      return { rate: 1.1, source: "test-historical" };
    }
    return null;
  }
}

test("same-currency conversion returns rate 1 without provider lookup", async () => {
  clearCurrencyRateCache();
  const provider = new TestRateProvider();
  const service = new CurrencyService(provider);

  const result = await service.convertClosedTrade({
    amount: 150,
    from: "USD",
    to: "USD",
    closedAt: "2026-09-08T12:00:00.000Z",
  });

  assert.equal(result.amount, 150);
  assert.equal(result.rate, 1);
  assert.equal(result.source, "same-currency");
  assert.equal(provider.calls, 0);
});

test("closed trades use historical FX rates", async () => {
  clearCurrencyRateCache();
  const service = new CurrencyService(new TestRateProvider());

  const result = await service.convertClosedTrade({
    amount: 100,
    from: "EUR",
    to: "USD",
    closedAt: "2026-09-08T12:00:00.000Z",
  });

  assert.equal(result.amount, 110);
  assert.equal(result.source, "test-historical");
  assert.equal(result.kind, "historical");
});

test("open positions use current FX rates", async () => {
  clearCurrencyRateCache();
  const service = new CurrencyService(new TestRateProvider());

  const result = await service.convertOpenPosition({
    amount: -50,
    from: "EUR",
    to: "USD",
  });

  assert.equal(result.amount, -60);
  assert.equal(result.source, "test-current");
  assert.equal(result.kind, "current");
});

test("provider rates are cached per pair/date/kind", async () => {
  clearCurrencyRateCache();
  const provider = new TestRateProvider();
  const service = new CurrencyService(provider);

  await service.convertClosedTrade({
    amount: 100,
    from: "EUR",
    to: "USD",
    closedAt: "2026-09-08T12:00:00.000Z",
  });
  await service.convertClosedTrade({
    amount: 200,
    from: "EUR",
    to: "USD",
    closedAt: "2026-09-08T18:00:00.000Z",
  });

  assert.equal(provider.calls, 1);
});

test("missing rates throw a conversion unavailable error", async () => {
  clearCurrencyRateCache();
  const service = new CurrencyService(new TestRateProvider());

  await assert.rejects(
    () =>
      service.convertClosedTrade({
        amount: 100,
        from: "GBP",
        to: "USD",
        closedAt: "2026-09-08T12:00:00.000Z",
      }),
    CurrencyConversionUnavailableError,
  );
});
