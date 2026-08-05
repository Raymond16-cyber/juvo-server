import mongoose from "mongoose";

const tradingPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
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
      required: true,
    },
    maxRiskPerTrade: {
      type: Number,
      default: 1,
      min: 0,
      max: 100,
    },
    maxDailyTrades: {
      type: Number,
      required: true,
      default: 5,
    },
    maxdailyLoss: {
      type: Number,
      required: true,
      default: 2,
      min: 0,
      max: 100,
    },
    maxWeeklyLoss: {
      type: Number,
      required: true,
      default: 5,
      min: 0,
      max: 100,
    },
    maxMonthlyLoss: {
      type: Number,
      required: true,
      default: 10,
      min: 0,
      max: 100,
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
    minimumRR: {
      type: Number,
      required: true,
      default: 1,
    },
    allowedSessions: [
      {
        type: String,
        enum: ["Asian", "Sydney", "Tokyo", "London", "New York"],
      },
    ],
    status: {
      type: String,

      enum: ["Active", "Completed", "Archived"],

      default: "Active",
    },
    rules: [
      {
        title: String,
        description: String,
        category: {
          type: String,
          enum: ["Risk", "Psychology", "Strategy", "General"],
          default: "General",
        },
      },
    ],
    notes: {
      type: String,
      required: false,
      maxlength: 2000,
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
  },
  {
    timestamps: true,
  },
);

tradingPlanSchema.index(
  {
    user: 1,
    tradingAccount: 1,
    status: 1,
  },
  {
    unique: true,
  },
);

const TradingPlan = mongoose.model("TradingPlan", tradingPlanSchema);
export default TradingPlan;
