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
  const currency = (payload.currency || "").trim().toUpperCase();
  const currentEquity = Number(payload.initialBalance || 0);

  if (!accountName) error.push("Account name is required.");
  if (!accountNumber) error.push("Account number is required.");
  if (!accountType) error.push("Account type is required.");
  if (!broker) error.push("Broker is required.");
  if (!initialBalance) error.push("Initial balance is required.");
  if (!currentBalance) error.push("Please provide initial balance.");
  if (!platform) error.push("Platform is required.");
  if (!leverage) error.push("Leverage is required.");
  if (!currency) error.push("Currency is required.");
  if (!currentEquity) error.push("Please provide initial balance.");

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
      currentEquity,
    },
  };
}



export { validateTradingAccountInput };