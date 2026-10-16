import mongoose from "mongoose";

const waitlistInvitationSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 120, default: "" },
    email: { type: String, required: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: ["pending", "sent", "redeemed", "expired", "revoked"],
      default: "pending",
      index: true,
    },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    discountPercent: { type: Number, required: true, enum: [40], default: 40 },
    emailDelivery: {
      status: {
        type: String,
        enum: ["pending", "sent", "failed"],
        default: "pending",
      },
      sentAt: Date,
      failedAt: Date,
      retryCount: { type: Number, default: 0 },
      lastError: String,
    },
    reservedPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      select: false,
    },
    reservationExpiresAt: { type: Date, select: false },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
    },
    paymentReference: String,
    redeemedAt: Date,
  },
  { timestamps: true },
);

waitlistInvitationSchema.index({ email: 1 }, { unique: true });
waitlistInvitationSchema.index({ status: 1, expiresAt: 1 });

waitlistInvitationSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.codeHash;
    delete ret.reservedPaymentId;
    delete ret.reservationExpiresAt;
    return ret;
  },
});

export default mongoose.model("WaitlistInvitation", waitlistInvitationSchema);
