import dotenv from "dotenv";

dotenv.config();

const key = process.env.PAYSTACK_SECRET_KEY.trim();
const plan = process.env.PAYSTACK_PRO_MONTHLY_PLAN_CODE.trim();

async function paystack(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload;
  try { payload = await response.json(); } catch { payload = { message: "non-json" }; }
  return { http: response.status, payload };
}

const balance = await paystack("/balance");
console.log(JSON.stringify({
  balance: {
    http: balance.http,
    status: balance.payload?.status,
    message: balance.payload?.message,
    currencies: Array.isArray(balance.payload?.data) ? balance.payload.data.map((row) => row.currency) : null,
  },
}));

const reference = `juvo_probe_${Date.now()}`;
const initialized = await paystack("/transaction/initialize", {
  method: "POST",
  body: {
    email: "juvo-live-probe@example.com",
    amount: 1993685,
    plan,
    reference,
    callback_url: process.env.PAYSTACK_CALLBACK_URL,
    metadata: { juvo: { probe: true } },
  },
});

const data = initialized.payload?.data || {};
console.log(JSON.stringify({
  initialize: {
    http: initialized.http,
    status: initialized.payload?.status,
    message: initialized.payload?.message,
    reference: data.reference || null,
    hasAuthorizationUrl: Boolean(data.authorization_url),
    accessCodePresent: Boolean(data.access_code),
  },
}));

if (data.authorization_url) {
  const page = await fetch(data.authorization_url, { redirect: "follow" });
  const html = await page.text();
  const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].slice(0, 8).map((match) => match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
  console.log(JSON.stringify({
    checkout: {
      http: page.status,
      finalUrlHost: new URL(page.url).host,
      title: (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || null,
      length: html.length,
      buttons,
      hasPayText: /pay|subscribe|continue/i.test(html),
      snippet: html.slice(0, 500).replace(/\s+/g, " "),
    },
  }));
}
