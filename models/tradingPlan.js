import mongoose from "mongoose";

const RULE_CATEGORIES = [
  "Risk",
  "Strategy",
  "Sessions",
  "Behaviour",
  "Commitment",
  "General",
];

const RULE_KINDS = ["rule", "commitment"];

const planRuleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      trim: true,
      maxlength: 80,
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
    category: {
      type: String,
      enum: RULE_CATEGORIES,
      default: "General",
    },
    kind: {
      type: String,
      enum: RULE_KINDS,
      default: "rule",
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    metric: {
      type: String,
      trim: true,
      maxlength: 60,
      default: null,
    },
    source: {
      type: String,
      enum: ["manual", "ai_suggestion", "system"],
      default: "manual",
    },
    suggestionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlanSuggestion",
      default: null,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
    modifiedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

const tradingPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    // Stable id shared across versions of the same plan lineage.
    planKey: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    version: {
      type: Number,
      min: 1,
      default: 1,
    },
    supersedes: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingPlan",
      default: null,
    },
    validFrom: {
      type: Date,
      required: true,
    },
    validUntil: {
      type: Date,
      required: true,
      validate: {
        validator(value) {
          return value > this.validFrom;
        },
        message: "validUntil must be after validFrom.",
      },
    },
    strategy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingStrategy",
      required: false,
      default: null,
    },
    strategyLabel: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    maxRiskPerTrade: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    maxDailyTrades: {
      type: Number,
      default: null,
      min: 0,
    },
    maxDailyLoss: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    maxWeeklyLoss: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    maxMonthlyLoss: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    maxConsecutiveLosses: {
      type: Number,
      default: null,
      min: 0,
    },
    minimumRR: {
      type: Number,
      default: null,
      min: 0,
    },
    entryTimeframe: {
      type: String,
      trim: true,
      maxlength: 20,
      default: "",
    },
    analysisTimeframe: {
      type: String,
      trim: true,
      maxlength: 20,
      default: "",
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tradingAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingAccount",
      required: true,
    },
    allowedSessions: [
      {
        type: String,
        enum: ["Asian", "Sydney", "Tokyo", "London", "New York"],
      },
    ],
    customHours: {
      start: { type: String, trim: true, maxlength: 8, default: "" },
      end: { type: String, trim: true, maxlength: 8, default: "" },
      timezone: { type: String, trim: true, maxlength: 80, default: "" },
    },
    status: {
      type: String,
      enum: ["Active", "Completed", "Archived"],
      default: "Active",
    },
    rules: [planRuleSchema],
    notes: {
      type: String,
      required: false,
      maxlength: 2000,
      default: "",
    },
    checklist: [
      {
        title: String,
        description: String,
        required: {
          type: Boolean,
          default: true,
        },
      },
    ],
    changeSummary: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

// One active plan per user + trading account.
tradingPlanSchema.index(
  { userId: 1, tradingAccount: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "Active" },
  },
);

tradingPlanSchema.index({ userId: 1, planKey: 1, version: -1 });
tradingPlanSchema.index({ userId: 1, status: 1, validFrom: -1 });

tradingPlanSchema.pre("validate", function ensureVersionMeta(next) {
  if (!this.planKey) {
    this.planKey = this._id || new mongoose.Types.ObjectId();
  }
  if (!this.version) {
    this.version = 1;
  }
  if (!this.validFrom) {
    this.validFrom = this.createdAt || new Date();
  }
  if (!this.validUntil) {
    this.validUntil = new Date("9999-12-31T23:59:59.999Z");
  }
  next();
});

export const TRADING_PLAN_RULE_CATEGORIES = RULE_CATEGORIES;
export const TRADING_PLAN_RULE_KINDS = RULE_KINDS;

const TradingPlan = mongoose.model("TradingPlan", tradingPlanSchema);
export default TradingPlan;
