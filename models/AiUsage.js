import mongoose from "mongoose";

const aiUsageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    feature: {
      type: String,
      required: true,
      trim: true,
    },
    periodKey: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}$/,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

aiUsageSchema.index(
  { user: 1, feature: 1, periodKey: 1 },
  { unique: true, name: "ai_usage_user_feature_period" },
);

const AiUsage = mongoose.model("AiUsage", aiUsageSchema);

export default AiUsage;
