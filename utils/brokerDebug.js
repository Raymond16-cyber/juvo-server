const isBrokerDebugEnabled = process.env.NODE_ENV !== "production";

function redactSecret(value) {
  if (value == null || value === "") return value;
  const text = String(value);
  if (text.length <= 8) return `*** (len=${text.length})`;
  return `${text.slice(0, 4)}...${text.slice(-4)} (len=${text.length})`;
}

function brokerLog(step, details) {
  if (!isBrokerDebugEnabled) return;

  if (details === undefined) {
    console.log(`[broker] ${step}`);
    return;
  }

  console.log(`[broker] ${step}`, details);
}

function brokerWarn(step, details) {
  if (!isBrokerDebugEnabled) return;
  console.warn(`[broker] ${step}`, details ?? "");
}

function brokerError(step, error, details) {
  console.error(`[broker] ${step}`, {
    ...(details || {}),
    message: error?.message,
    status: error?.status,
    stack: isBrokerDebugEnabled ? error?.stack : undefined,
  });
}

export { brokerLog, brokerWarn, brokerError, redactSecret, isBrokerDebugEnabled };