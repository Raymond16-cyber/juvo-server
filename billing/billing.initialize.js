import Payment from "../models/Payment.js";
import PaymentWebhookEvent from "../models/PaymentWebhookEvent.js";
import Subscription from "../models/Subscription.js";
import WaitlistInvitation from "../models/WaitlistInvitation.js";
import Waitlist from "../models/Waitlist.js";
import WaitlistCampaignSend from "../models/WaitlistCampaignSend.js";

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
  // Keep the sparse unique index for Paystack transaction IDs.
  await ensureSparseUniqueIndex(Payment, "paystackTransactionId_1", {
    paystackTransactionId: 1,
  });

  // Create indexes declared in each model's schema.
  // Subscription's partial unique index is defined in Subscription.js.
  for (const model of [
    Subscription,
    Payment,
    PaymentWebhookEvent,
    WaitlistInvitation,
    Waitlist,
    WaitlistCampaignSend,
  ]) {
    await model.createIndexes();
  }
}

