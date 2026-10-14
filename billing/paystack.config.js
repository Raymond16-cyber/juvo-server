const PLAN_ENV = Object.freeze({
  pro: { monthly: "PAYSTACK_PRO_MONTHLY_PLAN_CODE" },
  super: { monthly: "PAYSTACK_SUPER_MONTHLY_PLAN_CODE" },
});
const TEST_PLAN_ENV = Object.freeze({
  pro: { monthly: "PAYSTACK_TEST_PRO_MONTHLY_PLAN_CODE" },
  super: { monthly: "PAYSTACK_TEST_SUPER_MONTHLY_PLAN_CODE" },
});

function configurationError(message) {
  return Object.assign(new Error(message), {
    status: 503,
    code: "BILLING_UNAVAILABLE",
    safeBilling: true,
  });
}

function value(env, name) {
  return typeof env[name] === "string" ? env[name].trim() : "";
}

function billingConfig(env = process.env) {
  const requestedMode = value(env, "PAYSTACK_MODE").toLowerCase();
  const inferredMode = value(env, "PAYSTACK_SECRET_KEY").startsWith("sk_test_")
    ? "test"
    : "live";
  const mode = requestedMode || inferredMode;
  if (mode !== "test" && mode !== "live") {
    throw configurationError("PAYSTACK_MODE must be either test or live.");
  }
  const secretKey =
    value(
      env,
      mode === "test" ? "PAYSTACK_TEST_SECRET_KEY" : "PAYSTACK_LIVE_SECRET_KEY",
    ) || value(env, "PAYSTACK_SECRET_KEY");
  const currency = value(env, "PAYSTACK_BILLING_CURRENCY").toUpperCase();
  const planEnvironment = mode === "test" ? TEST_PLAN_ENV : PLAN_ENV;
  const plans = Object.fromEntries(
    Object.entries(planEnvironment).map(([plan, intervals]) => [
      plan,
      Object.fromEntries(
        Object.entries(intervals).map(([interval, variable]) => [
          interval,
          value(env, variable) || value(env, PLAN_ENV[plan][interval]),
        ]),
      ),
    ]),
  );
  const configured = Boolean(
    secretKey && currency && plans.pro.monthly && plans.super.monthly,
  );
  if (!configured) return { enabled: false, plans, currency: currency || null };
  if (
    !new RegExp(`^sk_${mode}_[A-Za-z0-9]+$`).test(secretKey) ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    throw configurationError(
      "Paystack billing mode and secret key do not match.",
    );
  }
  return {
    enabled: true,
    mode,
    secretKey,
    currency,
    plans,
    apiBaseUrl: "https://api.paystack.co",
  };
}

function requireBillingConfig() {
  const config = billingConfig();
  if (!config.enabled)
    throw configurationError("Payments are not configured yet.");
  return config;
}

function callbackUrl(env = process.env) {
  const raw =
    env.PAYSTACK_CALLBACK_URL ||
    (env.CLIENT_URL
      ? `${env.CLIENT_URL.replace(/\/$/, "")}/home/general/subscriptions`
      : "");
  if (!raw)
    throw configurationError(
      "PAYSTACK_CALLBACK_URL or CLIENT_URL is required for checkout.",
    );
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw configurationError("PAYSTACK_CALLBACK_URL must be a valid URL.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    parsed.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      local &&
      parsed.protocol === "http:"
    )
  ) {
    throw configurationError(
      "PAYSTACK_CALLBACK_URL must use HTTPS outside local development.",
    );
  }
  return parsed.href;
}

export {
  PLAN_ENV,
  billingConfig,
  callbackUrl,
  configurationError,
  requireBillingConfig,
};
