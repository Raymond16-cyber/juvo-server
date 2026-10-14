import dotenv from "dotenv";

dotenv.config();

function shape(key) {
  const raw = key == null ? "" : String(key);
  const value = raw.trim();
  let mode = "unknown-prefix";
  if (!value) mode = "missing";
  else if (value.startsWith("sk_test_")) mode = "test";
  else if (value.startsWith("sk_live_")) mode = "live";
  return {
    mode,
    length: value.length,
    hasWhitespace: value !== raw,
    matchesPattern: /^sk_(test|live)_[A-Za-z0-9]+$/.test(value),
  };
}

const live = process.env.PAYSTACK_SECRET_KEY;
const test = process.env.PAYSTACK_TEST_SECRET_KEY;
const plans = {
  pro: process.env.PAYSTACK_PRO_MONTHLY_PLAN_CODE,
  super: process.env.PAYSTACK_SUPER_MONTHLY_PLAN_CODE,
  testPro: process.env.PAYSTACK_TEST_PRO_MONTHLY_PLAN_CODE,
  testSuper: process.env.PAYSTACK_TEST_SUPER_MONTHLY_PLAN_CODE,
};

console.log(JSON.stringify({
  nodeEnv: process.env.NODE_ENV,
  secret: shape(live),
  testSecret: shape(test),
  planCodes: plans,
  currency: process.env.PAYSTACK_BILLING_CURRENCY,
  callback: process.env.PAYSTACK_CALLBACK_URL,
}, null, 2));

async function probe(label, key, code) {
  if (!key || !code) {
    console.log(JSON.stringify({ label, skipped: true }));
    return;
  }
  const response = await fetch(`https://api.paystack.co/plan/${encodeURIComponent(code.trim())}`, {
    headers: { Authorization: `Bearer ${key.trim()}` },
  });
  let body;
  try { body = await response.json(); } catch { body = { status: false, message: "non-json" }; }
  const data = body?.data || {};
  console.log(JSON.stringify({
    label,
    http: response.status,
    status: body?.status,
    message: body?.message,
    plan: data.plan_code ? {
      name: data.name,
      plan_code: data.plan_code,
      amount: data.amount,
      currency: data.currency,
      interval: data.interval,
      is_deleted: data.is_deleted,
      is_archived: data.is_archived,
    } : null,
  }));
}

const pairs = [
  ["live-key/configured-pro", live, plans.pro],
  ["live-key/configured-super", live, plans.super],
  ["live-key/test-pro", live, plans.testPro],
  ["live-key/test-super", live, plans.testSuper],
  ["test-key/configured-pro", test, plans.pro],
  ["test-key/configured-super", test, plans.super],
  ["test-key/test-pro", test, plans.testPro],
  ["test-key/test-super", test, plans.testSuper],
];

for (const [label, key, code] of pairs) {
  await probe(label, key, code);
}
