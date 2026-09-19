const ISO_CURRENCY_RE = /^[A-Z]{3}$/;

function normalizeCurrencyCode(value, fallback = null) {
  const code = String(value || "").trim().toUpperCase();
  if (ISO_CURRENCY_RE.test(code)) return code;
  return fallback;
}

function currencyDateKey(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function roundMoney(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

function resolveReportingCurrency(user) {
  return (
    normalizeCurrencyCode(user?.preferences?.reportingCurrency) ||
    normalizeCurrencyCode(user?.reportingCurrency) ||
    normalizeCurrencyCode(user?.preferences?.preferredCurrency) ||
    "USD"
  );
}

function resolveAccountCurrency(account, fallback = null) {
  return (
    normalizeCurrencyCode(account?.accountCurrency) ||
    normalizeCurrencyCode(account?.currency) ||
    normalizeCurrencyCode(fallback)
  );
}

function resolveTradeCurrency(trade, account, fallback = null) {
  return (
    normalizeCurrencyCode(trade?.profitLossCurrency) ||
    resolveAccountCurrency(account) ||
    normalizeCurrencyCode(fallback)
  );
}

export {
  currencyDateKey,
  normalizeCurrencyCode,
  resolveAccountCurrency,
  resolveReportingCurrency,
  resolveTradeCurrency,
  roundMoney,
};
