import Payment from "../models/Payment.js";
import PaymentWebhookEvent from "../models/PaymentWebhookEvent.js";
import Subscription from "../models/Subscription.js";

export async function initializeBillingIndexes() {
  for (const model of [Subscription, Payment, PaymentWebhookEvent]) await model.createIndexes();
}
