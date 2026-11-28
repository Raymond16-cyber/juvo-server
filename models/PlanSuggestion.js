import mongoose from "mongoose";

const planSuggestionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
      index: true,
    },
    messageCreatedAt: {
      type: Date,
      default: null,
    },
    type: {
      type: String,
      enum: [
        "new_rule",
        "new_commitment",
        "modify_rule",
        "deactivate_rule",
      ],
      required: true,
    },
    category: {
      type: String,
      enum: [
        "Risk",
        "Strategy",
        "Sessions",
        "Behaviour",
        "Commitment",
        "General",
      ],
      default: "Behaviour",
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    proposedRule: {
      title: { type: String, trim: true, maxlength: 160 },
      description: { type: String, trim: true, maxlength: 1000 },
      category: {
        type: String,
        enum: [
          "Risk",
          "Strategy",
          "Sessions",
          "Behaviour",
          "Commitment",
          "General",
        ],
      },
      kind: {
        type: String,
        enum: ["rule", "commitment"],
        default: "rule",
      },
      metric: { type: String, trim: true, maxlength: 60, default: null },
      value: { type: mongoose.Schema.Types.Mixed, default: null },
      enabled: { type: Boolean, default: true },
      planFieldUpdates: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    supportingContext: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    targetPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingPlan",
      default: null,
    },
    targetExistingRuleId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    fingerprint: {
      type: String,
      trim: true,
      maxlength: 128,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "declined", "expired"],
      default: "pending",
      index: true,
    },
    resultingPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingPlan",
      default: null,
    },
    resultingRuleId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

planSuggestionSchema.index({ user: 1, status: 1, createdAt: -1 });
planSuggestionSchema.index(
  { user: 1, fingerprint: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending", fingerprint: { $type: "string" } },
  },
);

const PlanSuggestion = mongoose.model("PlanSuggestion", planSuggestionSchema);
export default PlanSuggestion;
