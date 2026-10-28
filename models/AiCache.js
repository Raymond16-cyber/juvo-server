import mongoose from "mongoose";

const aiCacheSchema = new mongoose.Schema(
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
    cacheKey: {
      type: String,
      required: true,
      trim: true,
    },
    contentHash: {
      type: String,
      required: true,
      trim: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

aiCacheSchema.index(
  { user: 1, feature: 1, cacheKey: 1 },
  { unique: true, name: "ai_cache_user_feature_key" },
);

const AiCache = mongoose.model("AiCache", aiCacheSchema);

export default AiCache;
