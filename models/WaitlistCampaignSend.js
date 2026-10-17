import mongoose from "mongoose";

const waitlistCampaignSendSchema = new mongoose.Schema(
  {
    campaignId: { type: String, required: true, trim: true },
    kind: { type: String, enum: ["launch", "reminder"], required: true },
    waitlistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Waitlist",
      required: true,
    },
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WaitlistInvitation",
      required: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    sentAt: Date,
    failedAt: Date,
    lastError: String,
  },
  { timestamps: true },
);

waitlistCampaignSendSchema.index(
  { campaignId: 1, waitlistId: 1 },
  { unique: true },
);
waitlistCampaignSendSchema.index({ campaignId: 1, status: 1 });

export default mongoose.model(
  "WaitlistCampaignSend",
  waitlistCampaignSendSchema,
);
