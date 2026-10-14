import { createHmac, timingSafeEqual } from "node:crypto";
import { requireBillingConfig } from "../billing/paystack.config.js";
import {
  cancelSubscription, getBillingOverview, initializeCheckout, managementLink,
  processWebhookEvent, reconcileBilling, storeWebhookEvent, verifyCheckout,
} from "../services/billing.service.js";

function getUserId(user) { return user?.id || user?._id; }

async function getBillingController(req, res, next) {
  try { return res.json({ message: "Billing details retrieved.", data: await getBillingOverview({ user: getUserId(req.user) }) }); }
  catch (error) { return next(error); }
}
async function initializeCheckoutController(req, res, next) {
  try {
    const { plan, billingInterval } = req.body || {};
    const data = await initializeCheckout({ user: getUserId(req.user), plan, billingInterval });
    return res.status(201).json({ message: "Checkout initialized.", data });
  } catch (error) { return next(error); }
}
async function verifyPaymentController(req, res, next) {
  try {
    const data = await verifyCheckout({ user: getUserId(req.user), reference: req.body?.reference });
    return res.json({ message: data.status === "success" ? "Payment verified." : "Payment is still pending.", data });
  } catch (error) { return next(error); }
}
async function cancelSubscriptionController(req, res, next) {
  try { return res.json({ message: "Renewal cancelled. Current paid access remains until its expiry.", data: await cancelSubscription({ user: getUserId(req.user), subscriptionId: req.params.subscriptionId }) }); }
  catch (error) { return next(error); }
}
async function managementLinkController(req, res, next) {
  try { return res.json({ message: "Subscription management link created.", data: await managementLink({ user: getUserId(req.user), subscriptionId: req.params.subscriptionId }) }); }
  catch (error) { return next(error); }
}
async function reconcileBillingController(req, res, next) {
  try { return res.json({ message: "Billing status reconciled.", data: await reconcileBilling({ user: getUserId(req.user) }) }); }
  catch (error) { return next(error); }
}

function webhookSignatureIsValid(rawBody, signature) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== "string") return false;
  let expected;
  try { expected = createHmac("sha512", requireBillingConfig().secretKey).update(rawBody).digest("hex"); }
  catch { return false; }
  const received = Buffer.from(signature, "utf8"), calculated = Buffer.from(expected, "utf8");
  return received.length === calculated.length && timingSafeEqual(received, calculated);
}
async function paystackWebhookController(req, res) {
  const rawBody = req.body;
  if (!webhookSignatureIsValid(rawBody, req.get("x-paystack-signature"))) return res.status(401).json({ message: "Invalid webhook signature." });
  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch { return res.status(400).json({ message: "Webhook body must be valid JSON." }); }
  if (!payload?.event || typeof payload.event !== "string") return res.status(400).json({ message: "Webhook event is invalid." });
  try {
    const stored = await storeWebhookEvent({ event: payload.event, payload, rawBody });
    res.status(200).json({ received: true });
    if (stored) setImmediate(() => { void processWebhookEvent(stored._id).catch(() => undefined); });
  } catch {
    // Returning an error asks Paystack to retry; no secret or provider detail is exposed.
    return res.status(503).json({ message: "Webhook processing is temporarily unavailable." });
  }
}

export {
  cancelSubscriptionController, getBillingController, initializeCheckoutController,
  managementLinkController, paystackWebhookController, reconcileBillingController,
  verifyPaymentController,
};
