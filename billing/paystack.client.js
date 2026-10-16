import { requireBillingConfig } from "./paystack.config.js";

function providerError(message, status = 502) {
  return Object.assign(new Error(message), {
    status,
    code: "PAYSTACK_ERROR",
    safeBilling: true,
  });
}

async function request(path, { method = "GET", body } = {}) {
  const config = requireBillingConfig();
  let response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw providerError(
      "Paystack is temporarily unavailable. Please try again shortly.",
      503,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw providerError("Paystack returned an invalid response.");
  }
  if (!response.ok || !payload?.status)
    throw providerError(
      "Paystack could not complete this request.",
      response.status >= 400 && response.status < 500 ? 400 : 502,
    );
  return payload.data;
}

export const paystackClient = {
  getPlan: (code) => request(`/plan/${encodeURIComponent(code)}`),
  initializeTransaction: (body) =>
    request("/transaction/initialize", { method: "POST", body }),
  verifyTransaction: (reference) =>
    request(`/transaction/verify/${encodeURIComponent(reference)}`),
  getSubscription: (code) =>
    request(`/subscription/${encodeURIComponent(code)}`),
  createSubscription: (body) =>
    request("/subscription", { method: "POST", body }),
  disableSubscription: (body) =>
    request("/subscription/disable", { method: "POST", body }),
  getSubscriptionManagementLink: (code) =>
    request(`/subscription/${encodeURIComponent(code)}/manage/link`),
};
