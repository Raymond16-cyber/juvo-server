import Payment from "../models/Payment.js";
import PaymentWebhookEvent from "../models/PaymentWebhookEvent.js";
import Subscription from "../models/Subscription.js";
import WaitlistInvitation from "../models/WaitlistInvitation.js";

async function ensureSparseUniqueIndex(model, name, key) {
  const indexes = await model.collection.indexes();
  const matching = indexes.filter(
    (index) =>
      JSON.stringify(index.key) === JSON.stringify(key) && index.unique,
  );
  const correct = matching.find(
    (index) => index.name === name && index.sparse === true,
  );
  if (correct) return;
  for (const index of matching) await model.collection.dropIndex(index.name);
  await model.collection.createIndex(key, { name, unique: true, sparse: true });
}

export async function initializeBillingIndexes() {
  await ensureSparseUniqueIndex(
    Subscription,
    "provider_1_paystackSubscriptionCode_1",
    { provider: 1, paystackSubscriptionCode: 1 },
  );
  await ensureSparseUniqueIndex(Payment, "paystackTransactionId_1", {
    paystackTransactionId: 1,
  });
  for (const model of [
    Subscription,
    Payment,
    PaymentWebhookEvent,
    WaitlistInvitation,
  ])
    await model.createIndexes();
}
