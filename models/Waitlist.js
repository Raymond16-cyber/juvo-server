import mongoose from "mongoose";

const waitlistSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 120, default: "" },
    email: { type: String, required: true, lowercase: true, trim: true },
    status: {
      type: String,
      enum: ["active", "converted", "unsubscribed"],
      default: "active",
      index: true,
    },
    promotionalOptOut: { type: Boolean, default: false, index: true },
    unsubscribeTokenHash: { type: String, required: true, select: false },
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WaitlistInvitation",
      index: true,
    },
    joinedAt: { type: Date, required: true },
    unsubscribedAt: Date,
    launchUnsubscribeTokenHash: { type: String, select: false },
  },
  { timestamps: true },
);

waitlistSchema.index({ email: 1 }, { unique: true });
waitlistSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.unsubscribeTokenHash;
    return ret;
  },
});

export default mongoose.model("Waitlist", waitlistSchema);
