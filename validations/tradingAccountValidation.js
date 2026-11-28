function validateTradingAccountInput(payload) {
  const error = [];

  const accountName = (payload.accountName || "").trim().toLowerCase();
  const accountNumber = (payload.accountNumber || "").trim();
  const accountType = (payload.accountType || "").trim().toLowerCase();
  const broker = (payload.broker || "").trim().toLowerCase();
  const initialBalance = Number(payload.initialBalance || 0);
  const currentBalance = Number(payload.initialBalance || 0);
  const platform = (payload.platform || "").trim().toLowerCase();
  const server = (payload.server || "").trim().toLowerCase();
  const leverage = (payload.leverage || "").trim().toLowerCase();
  const currency = (payload.accountCurrency || payload.currency || "")
    .trim()
    .toUpperCase();
  const currentEquity = Number(payload.initialBalance || 0);
  const maxDrawnDown = Number(payload.maxDrawnDown || 0);
  const profitTarget = Number(payload.profitTarget || 0);

  if (!accountName) error.push("Account name is required.");
  if (!accountNumber) error.push("Account number is required.");
  if (!accountType) error.push("Account type is required.");
  if (!broker) error.push("Broker is required.");
  if (!initialBalance) error.push("Initial balance is required.");
  if (!currentBalance) error.push("Please provide initial balance.");
  if (!platform) error.push("Platform is required.");
  if (!leverage) error.push("Leverage is required.");
  if (!currency) error.push("Currency is required.");
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    error.push("Currency must be a valid 3-letter ISO code.");
  }
  if (!currentEquity) error.push("Please provide initial balance.");
  if (maxDrawnDown < 0) error.push("Maximum drawdown cannot be negative.");
  if (profitTarget < 0) error.push("Profit target cannot be negative.");

  return {
    isValid: error.length === 0,
    errors: error,
    data: {
      accountName,
      accountNumber,
      accountType,
      broker,
      initialBalance,
      currentBalance,
      platform,
      server,
      leverage,
      currency,
      accountCurrency: currency,
      currentEquity,
      maxDrawnDown,
      profitTarget,
    },
  };
}

function validateTradingAccountUpdateInput(payload = {}) {
  const errors = [];
  const data = {};
  const allowedFields = ["accountName", "maxDrawnDown", "profitTarget"];

  for (const key of ["accountNumber", "broker", "platform", "currency"]) {
    if (payload[key] !== undefined) {
      errors.push(`${key} cannot be changed for a trading account.`);
    }
  }

  if (payload.accountName !== undefined) {
    if (typeof payload.accountName !== "string" || !payload.accountName.trim()) {
      errors.push("Account name is required.");
    } else if (payload.accountName.trim().length > 100) {
      errors.push("Account name cannot exceed 100 characters.");
    } else {
      data.accountName = payload.accountName.trim();
    }
  }

  for (const key of ["maxDrawnDown", "profitTarget"]) {
    if (payload[key] === undefined) continue;
    const value =
      typeof payload[key] === "number" || typeof payload[key] === "string"
        ? Number(payload[key])
        : Number.NaN;
    if (!Number.isFinite(value) || value < 0) {
      errors.push(
        key === "maxDrawnDown"
          ? "Maximum drawdown must be a non-negative number."
          : "Profit target must be a non-negative number.",
      );
    } else {
      data[key] = value;
    }
  }

  if (!allowedFields.some((key) => payload[key] !== undefined)) {
    errors.push("Provide an account name, maximum drawdown, or profit target.");
  }

  return { isValid: errors.length === 0, errors, data };
}

export {
  validateTradingAccountInput,
  validateTradingAccountUpdateInput,
};
