import mongoose from "mongoose";

const paymentWebhookEventSchema = new mongoose.Schema({
  provider: { type: String, enum: ["paystack"], required: true },
  eventKey: { type: String, required: true, unique: true },
  event: { type: String, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  status: { type: String, enum: ["received", "processing", "processed", "ignored", "failed"], default: "received", index: true },
  attempts: { type: Number, default: 0 },
  processedAt: Date,
  lastError: String,
}, { timestamps: true });

paymentWebhookEventSchema.index({ status: 1, updatedAt: 1 });

export default mongoose.model("PaymentWebhookEvent", paymentWebhookEventSchema);
