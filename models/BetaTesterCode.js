import mongoose from "mongoose";

/**
 * Private beta tester access codes.
 * Separate from WaitlistInvitation / billing discount codes.
 * Plaintext codes are never stored — only codeHash.
 */
const betaTesterCodeSchema = new mongoose.Schema(
  {
    codeHash: {
      type: String,
      required: true,
      select: false,
      unique: true,
      index: true,
    },

    // Last 4 chars of the plaintext code for admin listing (not enough to reconstruct).
    codeHint: {
      type: String,
      required: true,
      trim: true,
      maxlength: 8,
    },

    status: {
      type: String,
      enum: ["available", "exhausted", "revoked", "expired"],
      default: "available",
      index: true,
    },

    // Optional binding — code may only be redeemed by this email.
    boundEmail: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
      index: true,
    },

    maxRedemptions: {
      type: Number,
      default: 1,
      min: 1,
      max: 1000,
    },

    redemptionCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // When the CODE itself expires (before redemption). Null = no code expiry.
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    revokedReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    redemptions: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        redeemedAt: {
          type: Date,
          required: true,
          default: Date.now,
        },
        email: {
          type: String,
          lowercase: true,
          trim: true,
        },
      },
    ],

    createdBy: {
      type: String,
      trim: true,
      default: "cli",
    },
  },
  { timestamps: true },
);

betaTesterCodeSchema.index({ status: 1, expiresAt: 1 });
betaTesterCodeSchema.index({ "redemptions.user": 1 });

betaTesterCodeSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.codeHash;
    return ret;
  },
});

const BetaTesterCode = mongoose.model("BetaTesterCode", betaTesterCodeSchema);

export default BetaTesterCode;
