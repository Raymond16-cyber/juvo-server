import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    plan: { type: String, enum: ["pro", "super"], required: true },
    billingInterval: { type: String, enum: ["monthly"], required: true },
    provider: {
      type: String,
      enum: ["paystack"],
      default: "paystack",
      required: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "active",
        "non-renewing",
        "past-due",
        "cancelled",
        "expired",
      ],
      default: "pending",
      index: true,
    },
    currency: { type: String, required: true, uppercase: true, trim: true },
    amount: { type: Number, required: true, min: 1 },
    introductoryPaymentAmount: { type: Number, min: 1 },
    discountPercent: { type: Number, enum: [0, 40], default: 0 },
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WaitlistInvitation",
      select: false,
    },
    customerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      select: false,
    },
    paystackCustomerCode: { type: String, select: false },
    paystackSubscriptionCode: { type: String, select: false },
    paystackPlanCode: { type: String, required: true, select: false },
    paystackEmailToken: { type: String, select: false },
    authorization: {
      channel: String,
      last4: String,
      brand: String,
      reusable: Boolean,
    },
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: Date,
    lastReconciledAt: Date,
    lastError: { code: String, message: String },
  },
  { timestamps: true },
);

subscriptionSchema.index(
  { provider: 1, paystackSubscriptionCode: 1 },
  { unique: true, sparse: true },
);
subscriptionSchema.index({ userId: 1, provider: 1, status: 1, updatedAt: -1 });

subscriptionSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.customerEmail;
    delete ret.paystackCustomerCode;
    delete ret.paystackSubscriptionCode;
    delete ret.paystackPlanCode;
    delete ret.paystackEmailToken;
    return ret;
  },
});

export default mongoose.model("Subscription", subscriptionSchema);
