const isBrokerDebugEnabled =
  process.env.BROKER_DEBUG === "true" && process.env.NODE_ENV !== "production";

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|code|secret|token|state|password/i;

function redactSecret(value) {
  if (value == null || value === "") return value;
  const text = String(value);
  if (text.length <= 8) return `*** (len=${text.length})`;
  return `${text.slice(0, 4)}...${text.slice(-4)} (len=${text.length})`;
}

function sanitizeDetails(value, depth = 0) {
  if (value == null || depth > 4) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeDetails(item, depth + 1));
  }

  if (typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key)
        ? redactSecret(nestedValue)
        : sanitizeDetails(nestedValue, depth + 1),
    ]),
  );
}

function brokerLog(step, details) {
  if (!isBrokerDebugEnabled) return;

  if (details === undefined) {
    console.log(`[broker] ${step}`);
    return;
  }

  console.log(`[broker] ${step}`, sanitizeDetails(details));
}

function brokerWarn(step, details) {
  if (!isBrokerDebugEnabled) return;
  console.warn(`[broker] ${step}`, sanitizeDetails(details ?? ""));
}

function brokerError(step, error, details) {
  console.error(`[broker] ${step}`, {
    ...sanitizeDetails(details || {}),
    message: error?.message,
    status: error?.status,
    stack: isBrokerDebugEnabled ? error?.stack : undefined,
  });
}

export {
  brokerLog,
  brokerWarn,
  brokerError,
  redactSecret,
  sanitizeDetails,
  isBrokerDebugEnabled,
};
