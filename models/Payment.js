import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["paystack"],
      default: "paystack",
      required: true,
    },
    reference: { type: String, required: true, unique: true, immutable: true },
    plan: { type: String, enum: ["pro", "super"], required: true },
    billingInterval: { type: String, enum: ["monthly"], required: true },
    expectedPlanCode: { type: String, required: true, select: false },
    expectedAmount: { type: Number, required: true, min: 1 },
    normalExpectedAmount: { type: Number, min: 1 },
    discountPercent: { type: Number, enum: [0, 40], default: 0 },
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WaitlistInvitation",
      select: false,
    },
    currency: { type: String, required: true, uppercase: true, trim: true },
    customerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      select: false,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "success",
        "failed",
        "abandoned",
        "reversed",
      ],
      default: "pending",
      index: true,
    },
    paystackTransactionId: { type: String, sparse: true, unique: true },
    processingAt: Date,
    verifiedAt: Date,
    paidAt: Date,
    fulfilledAt: Date,
    failureReason: String,
  },
  { timestamps: true },
);

paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ subscriptionId: 1, createdAt: -1 });

paymentSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.expectedPlanCode;
    delete ret.customerEmail;
    return ret;
  },
});

export default mongoose.model("Payment", paymentSchema);
