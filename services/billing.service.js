import { createHash, randomUUID } from "node:crypto";
import Payment from "../models/Payment.js";
import PaymentWebhookEvent from "../models/PaymentWebhookEvent.js";
import Subscription from "../models/Subscription.js";
import User from "../models/User.js";
import { billingConfig, callbackUrl, configurationError, requireBillingConfig } from "../billing/paystack.config.js";
import { paystackClient } from "../billing/paystack.client.js";

const BILLING_PLANS = Object.freeze(["pro", "super"]);
const BILLING_INTERVALS = Object.freeze(["monthly"]);
const ACCESSIBLE_STATUSES = new Set(["active", "non-renewing", "past-due"]);

function billingError(message, status = 400, code = "BILLING_ERROR") {
  return Object.assign(new Error(message), { status, code, safeBilling: true });
}
function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function normalizeCurrency(value) { return String(value || "").trim().toUpperCase(); }
function userId(user) { return user?.id || user?._id || user; }
function providerSubscription(data = {}) { return data.subscription || data; }
function providerCustomer(data = {}) { return data.customer || data?.subscription?.customer || {}; }
function providerPlanCode(data = {}) {
  const plan = data?.plan || data?.subscription?.plan;
  return typeof plan === "string" ? plan : plan?.plan_code || plan?.code || data?.plan_code;
}
function providerSubscriptionCode(data = {}) {
  const subscription = providerSubscription(data);
  return subscription?.subscription_code || data?.subscription_code;
}
function safeAuthorization(authorization = {}) {
  return {
    channel: authorization.channel,
    last4: authorization.last4,
    brand: authorization.brand,
    reusable: typeof authorization.reusable === "boolean" ? authorization.reusable : undefined,
  };
}
function addInterval(start, interval) {
  const value = new Date(start);
  if (interval === "monthly") value.setUTCMonth(value.getUTCMonth() + 1);
  return value;
}
function periodEnd(data, start, interval) {
  const subscription = providerSubscription(data);
  return asDate(subscription?.next_payment_date) || asDate(data?.period_end) || addInterval(start, interval);
}
function subscriptionStatus(providerStatus, { cancelAtPeriodEnd = false } = {}) {
  if (cancelAtPeriodEnd || providerStatus === "non-renewing") return "non-renewing";
  if (providerStatus === "attention") return "past-due";
  if (providerStatus === "active") return "active";
  if (providerStatus === "completed" || providerStatus === "complete" || providerStatus === "cancelled") return "expired";
  return "pending";
}
function statusFromVerifiedCharge(transaction) {
  // A transaction's `success` is not a subscription status. Paystack only
  // includes a subscription object after it has been created asynchronously.
  const providerStatus = transaction?.subscription?.status;
  return providerStatus ? subscriptionStatus(providerStatus) : "active";
}
function paidAccess(subscription, now = new Date()) {
  if (!subscription || !ACCESSIBLE_STATUSES.has(subscription.status)) return false;
  return !subscription.currentPeriodEnd || new Date(subscription.currentPeriodEnd) > now;
}

async function resolvePlan(plan, interval) {
  if (!BILLING_PLANS.includes(plan) || !BILLING_INTERVALS.includes(interval)) throw billingError("Choose a valid JUVO plan.", 422, "PLAN_INVALID");
  const config = requireBillingConfig();
  const code = config.plans[plan][interval];
  const providerPlan = await paystackClient.getPlan(code);
  const amount = Number(providerPlan?.amount);
  const currency = normalizeCurrency(providerPlan?.currency);
  if (!Number.isSafeInteger(amount) || amount < 1 || providerPlan?.interval !== interval || currency !== config.currency) {
    throw configurationError("The configured Paystack plan does not match JUVO billing settings.");
  }
  return { plan, interval, code, amount, currency };
}

async function syncUserSubscription(subscription, now = new Date()) {
  const active = paidAccess(subscription, now);
  const value = active
    ? { plan: subscription.plan, status: subscription.status, startedAt: subscription.currentPeriodStart || now, expiresAt: subscription.currentPeriodEnd || null }
    : { plan: "free", status: "expired", expiresAt: subscription.currentPeriodEnd || now };
  await User.updateOne({ _id: subscription.userId }, { $set: { subscription: value } });
  return value;
}

async function repairSuccessfulPaymentSubscription(payment, now = new Date()) {
  if (payment?.status !== "success" || !payment.fulfilledAt) return null;
  const subscription = await Subscription.findById(payment.subscriptionId);
  if (!subscription || subscription.status !== "pending") return subscription;

  const start = subscription.currentPeriodStart || payment.paidAt || payment.fulfilledAt;
  const end = subscription.currentPeriodEnd || addInterval(start, subscription.billingInterval);
  const status = end > now ? "active" : "expired";
  await Subscription.updateOne({ _id: subscription._id, status: "pending" }, { $set: {
    status, currentPeriodStart: start, currentPeriodEnd: end,
    lastError: null, lastReconciledAt: now,
  } });
  const repaired = await Subscription.findById(subscription._id);
  await syncUserSubscription(repaired, now);
  return repaired;
}

async function findBlockingSubscription(id) {
  const subscriptions = await Subscription.find({ userId: id, provider: "paystack", status: { $in: ["active", "non-renewing", "past-due"] } }).sort({ updatedAt: -1 });
  return subscriptions.find((subscription) => paidAccess(subscription));
}

async function initializeCheckout({ user, plan, billingInterval = "monthly" }) {
  const id = userId(user);
  if (!id) throw billingError("User is not signed in.", 401, "UNAUTHORIZED");
  const currentUser = await User.findById(id).select("email fullName subscription");
  if (!currentUser?.email) throw billingError("A verified email is required before checkout.", 409, "EMAIL_REQUIRED");
  const existing = await findBlockingSubscription(id);
  if (existing) {
    throw billingError(existing.plan === plan ? "This plan is already active." : "Your current plan remains active. Cancel renewal before choosing another plan.", 409, "ACTIVE_SUBSCRIPTION");
  }
  const resolved = await resolvePlan(plan, billingInterval);
  const subscription = await Subscription.create({ userId: id, plan: resolved.plan, billingInterval: resolved.interval, status: "pending", currency: resolved.currency, amount: resolved.amount, customerEmail: currentUser.email, paystackPlanCode: resolved.code });
  const reference = `juvo_${randomUUID().replaceAll("-", "")}`;
  const payment = await Payment.create({ userId: id, subscriptionId: subscription._id, reference, plan: resolved.plan, billingInterval: resolved.interval, expectedPlanCode: resolved.code, expectedAmount: resolved.amount, currency: resolved.currency, customerEmail: currentUser.email });
  try {
    const initialized = await paystackClient.initializeTransaction({
      email: currentUser.email,
      amount: resolved.amount,
      plan: resolved.code,
      reference,
      callback_url: callbackUrl(),
      metadata: { juvo: { userId: String(id), subscriptionId: String(subscription._id), plan: resolved.plan, billingInterval: resolved.interval } },
    });
    if (!initialized?.authorization_url || initialized.reference !== reference) throw billingError("Paystack returned an invalid checkout response.", 502, "PAYSTACK_RESPONSE");
    return { authorizationUrl: initialized.authorization_url, reference, plan: resolved.plan, billingInterval: resolved.interval };
  } catch (error) {
    await Payment.updateOne({ _id: payment._id, status: "pending" }, { $set: { status: "failed", failureReason: "Checkout initialization failed" } });
    await Subscription.updateOne({ _id: subscription._id, status: "pending" }, { $set: { status: "cancelled", lastError: { code: error.code || "INITIALIZATION_FAILED", message: "Checkout could not be initialized." } } });
    throw error;
  }
}

function verifyExpectedTransaction(payment, transaction, expectedUserId) {
  if (!transaction || transaction.status !== "success" || transaction.reference !== payment.reference) throw billingError("Payment has not completed successfully.", 409, "PAYMENT_NOT_SUCCESSFUL");
  if (Number(transaction.amount) !== payment.expectedAmount || normalizeCurrency(transaction.currency) !== payment.currency) throw billingError("Payment details did not match the selected plan.", 409, "PAYMENT_MISMATCH");
  const transactionId = String(transaction.id || "");
  if (!transactionId) throw billingError("Paystack did not provide a transaction identifier.", 502, "PAYSTACK_RESPONSE");
  const metadata = typeof transaction.metadata === "string" ? (() => { try { return JSON.parse(transaction.metadata); } catch { return {}; } })() : transaction.metadata || {};
  const juvo = metadata.juvo || {};
  if (expectedUserId && String(juvo.userId || "") !== String(expectedUserId)) throw billingError("This payment does not belong to the signed-in JUVO account.", 403, "PAYMENT_OWNER");
  if (String(juvo.subscriptionId || "") !== String(payment.subscriptionId) || juvo.plan !== payment.plan || juvo.billingInterval !== payment.billingInterval) throw billingError("Payment metadata did not match the selected plan.", 409, "PAYMENT_MISMATCH");
  if (normalizeEmail(transaction.customer?.email) !== normalizeEmail(payment.customerEmail)) throw billingError("Payment email did not match the signed-in JUVO account.", 409, "PAYMENT_EMAIL");
  return transactionId;
}

async function fulfillVerifiedPayment(paymentId, transaction, expectedUserId) {
  const payment = await Payment.findById(paymentId).select("+expectedPlanCode +customerEmail");
  if (!payment) throw billingError("Payment not found.", 404, "PAYMENT_NOT_FOUND");
  const transactionId = verifyExpectedTransaction(payment, transaction, expectedUserId);
  if (payment.status === "success" && payment.fulfilledAt) {
    return { payment, subscription: await repairSuccessfulPaymentSubscription(payment), alreadyFulfilled: true };
  }
  const processingStartedBefore = new Date(Date.now() - 5 * 60 * 1000);
  const claimed = await Payment.findOneAndUpdate({
    _id: payment._id,
    fulfilledAt: null,
    $or: [
      { status: { $in: ["pending", "failed"] } },
      { status: "processing", $or: [{ processingAt: { $lt: processingStartedBefore } }, { processingAt: { $exists: false } }] },
    ],
  }, { $set: { status: "processing", processingAt: new Date(), paystackTransactionId: transactionId, verifiedAt: new Date() } }, { new: true }).select("+expectedPlanCode +customerEmail");
  if (!claimed) {
    const latest = await Payment.findById(payment._id);
    if (latest?.status === "success" && latest.fulfilledAt) return { payment: latest, alreadyFulfilled: true };
    return { payment: latest, processing: true, alreadyFulfilled: false };
  }
  try {
    const subscription = await Subscription.findById(claimed.subscriptionId).select("+paystackPlanCode +paystackSubscriptionCode +paystackEmailToken +customerEmail");
    if (!subscription || String(subscription.userId) !== String(claimed.userId) || subscription.paystackPlanCode !== claimed.expectedPlanCode) throw billingError("Subscription does not match this payment.", 409, "SUBSCRIPTION_MISMATCH");
    const start = asDate(transaction.paid_at) || new Date();
    const embeddedSubscription = transaction.subscription;
    const providerCode = providerSubscriptionCode(transaction);
    const customer = providerCustomer(transaction);
    const end = periodEnd(transaction, start, subscription.billingInterval);
    await Subscription.updateOne({ _id: subscription._id }, { $set: {
      status: statusFromVerifiedCharge(transaction),
      paystackCustomerCode: customer.customer_code,
      ...(providerCode ? { paystackSubscriptionCode: providerCode } : {}),
      ...(embeddedSubscription?.email_token ? { paystackEmailToken: embeddedSubscription.email_token } : {}),
      authorization: safeAuthorization(transaction.authorization), currentPeriodStart: start, currentPeriodEnd: end,
      cancelAtPeriodEnd: false, lastError: null, lastReconciledAt: new Date(),
    } });
    const activeSubscription = await Subscription.findById(subscription._id);
    await Payment.updateOne({ _id: claimed._id }, { $set: { status: "success", paidAt: start, processingAt: null, verifiedAt: new Date(), fulfilledAt: new Date(), paystackTransactionId: transactionId, failureReason: null } });
    await syncUserSubscription(activeSubscription);
    return { payment: await Payment.findById(claimed._id), subscription: activeSubscription, alreadyFulfilled: false };
  } catch (error) {
    await Payment.updateOne({ _id: claimed._id, status: "processing" }, { $set: { status: "failed", processingAt: null, failureReason: error.safeBilling ? error.message : "Payment processing failed" } });
    throw error;
  }
}

async function verifyCheckout({ user, reference }) {
  const id = userId(user);
  if (!id || typeof reference !== "string" || !/^juvo_[a-z0-9]{32}$/.test(reference)) throw billingError("Payment reference is invalid.", 422, "REFERENCE_INVALID");
  const payment = await Payment.findOne({ userId: id, reference }).select("+expectedPlanCode +customerEmail");
  if (!payment) throw billingError("Payment not found.", 404, "PAYMENT_NOT_FOUND");
  const transaction = await paystackClient.verifyTransaction(reference);
  if (transaction.status !== "success") {
    const status = ["failed", "abandoned", "reversed"].includes(transaction.status) ? transaction.status : "pending";
    await Payment.updateOne({ _id: payment._id, status: { $ne: "success" } }, { $set: { status, failureReason: status === "pending" ? undefined : "Payment was not successful" } });
    return { status, payment: await Payment.findById(payment._id) };
  }
  const result = await fulfillVerifiedPayment(payment._id, transaction, id);
  return { status: result.processing ? "processing" : "success", payment: result.payment, subscription: result.subscription, alreadyFulfilled: result.alreadyFulfilled };
}

async function applyProviderSubscription(data, { event } = {}) {
  const code = providerSubscriptionCode(data);
  const customer = providerCustomer(data);
  const planCode = providerPlanCode(data);
  let subscription = code ? await Subscription.findOne({ provider: "paystack", paystackSubscriptionCode: code }).select("+paystackPlanCode +paystackEmailToken +customerEmail") : null;
  if (!subscription && customer?.email && planCode) {
    subscription = await Subscription.findOne({ provider: "paystack", customerEmail: normalizeEmail(customer.email), paystackPlanCode: planCode, status: { $in: ["pending", "active", "non-renewing", "past-due"] } }).sort({ createdAt: -1 }).select("+paystackPlanCode +paystackEmailToken +customerEmail");
  }
  if (!subscription) return null;
  const start = asDate(data?.period_start) || asDate(data?.paid_at) || subscription.currentPeriodStart || new Date();
  const end = periodEnd(data, start, subscription.billingInterval);
  const keepsPaidAccess = event === "subscription.disable" && end > new Date();
  const providerStatus = data?.subscription?.status || (event === "renewal" && data?.status === "success" ? "active" : data?.status);
  const currentStatus = event === "subscription.not_renew" || keepsPaidAccess
    ? "non-renewing"
    : subscriptionStatus(providerStatus, { cancelAtPeriodEnd: event === "subscription.not_renew" });
  await Subscription.updateOne({ _id: subscription._id }, { $set: {
    status: currentStatus, ...(code ? { paystackSubscriptionCode: code } : {}),
    ...(customer?.customer_code ? { paystackCustomerCode: customer.customer_code } : {}),
    ...(providerSubscription(data)?.email_token ? { paystackEmailToken: providerSubscription(data).email_token } : {}),
    authorization: safeAuthorization(data.authorization || providerSubscription(data)?.authorization),
    currentPeriodStart: start, currentPeriodEnd: end,
    cancelAtPeriodEnd: event === "subscription.not_renew" || event === "subscription.disable" || currentStatus === "non-renewing",
    ...(event === "subscription.not_renew" ? { cancelledAt: new Date() } : {}), lastReconciledAt: new Date(),
  } });
  const updated = await Subscription.findById(subscription._id);
  await syncUserSubscription(updated);
  return updated;
}

async function recordRenewalPayment(transaction) {
  const subscriptionCode = providerSubscriptionCode(transaction);
  const reference = transaction?.reference;
  if (!subscriptionCode || !reference || transaction.status !== "success") return null;
  const subscription = await Subscription.findOne({ provider: "paystack", paystackSubscriptionCode: subscriptionCode }).select("+paystackPlanCode +customerEmail");
  if (!subscription) return null;
  if (Number(transaction.amount) !== subscription.amount || normalizeCurrency(transaction.currency) !== subscription.currency || normalizeEmail(transaction.customer?.email) !== normalizeEmail(subscription.customerEmail)) {
    throw billingError("Renewal payment did not match its JUVO subscription.", 409, "RENEWAL_MISMATCH");
  }
  const transactionId = String(transaction.id || "");
  if (!transactionId) throw billingError("Paystack did not provide a transaction identifier.", 502, "PAYSTACK_RESPONSE");
  const existing = await Payment.findOne({ provider: "paystack", reference });
  if (!existing) {
    try {
      await Payment.create({
        userId: subscription.userId, subscriptionId: subscription._id, reference,
        plan: subscription.plan, billingInterval: subscription.billingInterval,
        expectedPlanCode: subscription.paystackPlanCode, expectedAmount: subscription.amount,
        currency: subscription.currency, customerEmail: subscription.customerEmail,
        status: "success", paystackTransactionId: transactionId,
        verifiedAt: new Date(), paidAt: asDate(transaction.paid_at) || new Date(), fulfilledAt: new Date(),
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  return applyProviderSubscription(transaction, { event: "renewal" });
}

async function processWebhookPayload(event, data) {
  if (event === "charge.success") {
    const reference = data?.reference;
    if (!reference) return { ignored: true };
    const payment = reference ? await Payment.findOne({ provider: "paystack", reference }).select("+expectedPlanCode +customerEmail") : null;
    const verified = await paystackClient.verifyTransaction(reference);
    if (payment) {
      await fulfillVerifiedPayment(payment._id, verified, payment.userId);
      return { paymentId: String(payment._id) };
    }
    const subscription = await recordRenewalPayment(verified);
    return subscription ? { subscriptionId: String(subscription._id) } : { ignored: true };
  }
  if (event === "subscription.create" || event === "subscription.not_renew") return { subscription: await applyProviderSubscription(data, { event }) };
  if (event === "subscription.disable") {
    const subscription = await applyProviderSubscription(data, { event });
    if (subscription) {
      await Subscription.updateOne({ _id: subscription._id }, { $set: { status: paidAccess(subscription) ? "non-renewing" : "expired", cancelAtPeriodEnd: true } });
      await syncUserSubscription(await Subscription.findById(subscription._id));
    }
    return { subscription };
  }
  if (event === "invoice.payment_failed") {
    const subscription = await applyProviderSubscription(data, { event });
    if (subscription) {
      await Subscription.updateOne({ _id: subscription._id }, { $set: { status: "past-due", lastError: { code: "PAYMENT_FAILED", message: "Paystack could not renew this subscription." } } });
      await syncUserSubscription(await Subscription.findById(subscription._id));
    }
    return { subscription };
  }
  if (event === "invoice.create" || event === "invoice.update") return { subscription: await applyProviderSubscription(data, { event }) };
  return { ignored: true };
}

async function storeWebhookEvent({ event, payload, rawBody }) {
  const eventKey = createHash("sha256").update(rawBody).digest("hex");
  try { return await PaymentWebhookEvent.create({ provider: "paystack", eventKey, event, payload }); }
  catch (error) { if (error.code === 11000) return null; throw error; }
}

async function processWebhookEvent(id) {
  const event = await PaymentWebhookEvent.findOneAndUpdate({ _id: id, status: { $in: ["received", "failed"] } }, { $set: { status: "processing", lastError: null }, $inc: { attempts: 1 } }, { new: true }).select("+payload");
  if (!event) return null;
  try {
    const result = await processWebhookPayload(event.event, event.payload?.data || {});
    await PaymentWebhookEvent.updateOne({ _id: event._id }, { $set: { status: result.ignored ? "ignored" : "processed", processedAt: new Date() } });
    return result;
  } catch (error) {
    await PaymentWebhookEvent.updateOne({ _id: event._id }, { $set: { status: "failed", lastError: error.safeBilling ? error.code : "PROCESSING_FAILED" } });
    throw error;
  }
}

async function processQueuedWebhookEvents(limit = 25) {
  const events = await PaymentWebhookEvent.find({ status: { $in: ["received", "failed"] }, attempts: { $lt: 10 } }).sort({ updatedAt: 1 }).limit(limit).select("_id");
  await Promise.allSettled(events.map((event) => processWebhookEvent(event._id)));
  return events.length;
}

async function cancelSubscription({ user, subscriptionId }) {
  const id = userId(user);
  const subscription = await Subscription.findOne({ _id: subscriptionId, userId: id, provider: "paystack" }).select("+paystackSubscriptionCode +paystackEmailToken");
  if (!subscription) throw billingError("Subscription not found.", 404, "SUBSCRIPTION_NOT_FOUND");
  if (!paidAccess(subscription) || !subscription.paystackSubscriptionCode || !subscription.paystackEmailToken) throw billingError("This subscription cannot be cancelled through JUVO.", 409, "CANCELLATION_UNAVAILABLE");
  await paystackClient.disableSubscription({ code: subscription.paystackSubscriptionCode, token: subscription.paystackEmailToken });
  subscription.status = "non-renewing"; subscription.cancelAtPeriodEnd = true; subscription.cancelledAt = new Date();
  await subscription.save(); await syncUserSubscription(subscription);
  return subscription;
}

async function managementLink({ user, subscriptionId }) {
  const id = userId(user);
  const subscription = await Subscription.findOne({ _id: subscriptionId, userId: id, provider: "paystack" }).select("+paystackSubscriptionCode");
  if (!subscription?.paystackSubscriptionCode) throw billingError("No provider subscription is available to manage.", 409, "MANAGEMENT_UNAVAILABLE");
  const result = await paystackClient.getSubscriptionManagementLink(subscription.paystackSubscriptionCode);
  if (!result?.link || !/^https:\/\//.test(result.link)) throw billingError("Paystack could not create a management link.", 502, "PAYSTACK_RESPONSE");
  return { url: result.link };
}

async function reconcileBilling({ user }) {
  const id = userId(user);
  const subscriptions = await Subscription.find({ userId: id, provider: "paystack", status: { $in: ["active", "non-renewing", "past-due"] } }).select("+paystackSubscriptionCode");
  for (const subscription of subscriptions) {
    if (!subscription.paystackSubscriptionCode) continue;
    const fresh = await paystackClient.getSubscription(subscription.paystackSubscriptionCode);
    await applyProviderSubscription(fresh, { event: "reconcile" });
  }
  const pending = await Payment.find({ userId: id, provider: "paystack", status: "pending" }).sort({ createdAt: -1 }).limit(10);
  for (const payment of pending) await verifyCheckout({ user: id, reference: payment.reference });
  const fulfilled = await Payment.find({ userId: id, provider: "paystack", status: "success", fulfilledAt: { $ne: null } }).sort({ updatedAt: -1 }).limit(30);
  for (const payment of fulfilled) await repairSuccessfulPaymentSubscription(payment);
  return getBillingOverview({ user: id });
}

async function getBillingOverview({ user }) {
  const id = userId(user);
  const userDocument = await User.findById(id).select("subscription entitlements");
  if (!userDocument) throw billingError("User not found.", 404, "USER_NOT_FOUND");
  const [subscriptions, payments] = await Promise.all([
    Subscription.find({ userId: id, provider: "paystack" }).sort({ createdAt: -1 }).limit(10),
    Payment.find({ userId: id, provider: "paystack" }).sort({ createdAt: -1 }).limit(30),
  ]);
  const config = billingConfig();
  const plans = config.enabled ? await Promise.all(BILLING_PLANS.map(async (plan) => {
    try { const resolved = await resolvePlan(plan, "monthly"); return { plan, billingInterval: "monthly", amount: resolved.amount, currency: resolved.currency, available: true }; }
    catch { return { plan, billingInterval: "monthly", available: false }; }
  })) : [];
  return { enabled: config.enabled, plans, current: userDocument.subscription, subscriptions, payments };
}

let worker;
function startBillingWorker() {
  if (!worker) { worker = setInterval(() => { void processQueuedWebhookEvents(); }, 60000); worker.unref(); }
}
function stopBillingWorker() { if (worker) clearInterval(worker); worker = null; }

export {
  BILLING_INTERVALS, BILLING_PLANS, billingError, cancelSubscription, fulfillVerifiedPayment,
  getBillingOverview, initializeCheckout, managementLink, processQueuedWebhookEvents,
  paidAccess, processWebhookEvent, reconcileBilling, recordRenewalPayment, repairSuccessfulPaymentSubscription,
  startBillingWorker, stopBillingWorker, statusFromVerifiedCharge, storeWebhookEvent, subscriptionStatus,
  verifyCheckout, verifyExpectedTransaction,
};
