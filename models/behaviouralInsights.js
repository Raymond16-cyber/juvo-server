import mongoose from "mongoose";

const behaviouralInsightSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    journal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Journal",
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    category: {
      type: String,
      enum: ["psychology", "risk", "session", "edge", "discipline"],
      default: "discipline",
    },
    score: {
      type: Number,
      min: 0,
      max: 100,
    },
    source: {
      type: String,
      enum: ["ai", "system"],
      default: "system",
    },
  },
  {
    timestamps: true,
  },
);

behaviouralInsightSchema.index({ user: 1, createdAt: -1 });

const BehaviouralInsight = mongoose.model(
  "BehaviouralInsight",
  behaviouralInsightSchema,
);

export default BehaviouralInsight;
