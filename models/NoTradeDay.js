import mongoose from "mongoose";

const NO_TRADE_REASONS = Object.freeze([
  "no_valid_setup",
  "followed_plan",
  "rest_day",
  "market_unsuitable",
  "other",
]);

const noTradeDaySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    tradingAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingAccount",
      default: null,
    },

    journal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Journal",
      default: null,
    },

    // Calendar day in the user's timezone at record time (YYYY-MM-DD).
    localDayKey: {
      type: String,
      required: true,
      trim: true,
    },

    timezone: {
      type: String,
      required: true,
      trim: true,
    },

    confirmed: {
      type: Boolean,
      required: true,
      default: true,
      validate: {
        validator(value) {
          return value === true;
        },
        message: "No-trade days require explicit confirmation.",
      },
    },

    reason: {
      type: String,
      enum: NO_TRADE_REASONS,
      required: false,
      default: undefined,
    },

    reflection: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: "",
    },

    recordedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    // Set when a real trade is later logged on the same local day.
    supersededByTrade: {
      type: Boolean,
      default: false,
    },

    supersededAt: {
      type: Date,
      default: null,
    },

    ai: {
      interviewer: {
        questions: [String],
        contentHash: String,
        generatedAt: Date,
      },
    },
  },
  {
    timestamps: true,
  },
);

noTradeDaySchema.index(
  { user: 1, localDayKey: 1 },
  { unique: true, name: "no_trade_day_user_local_day" },
);

const NoTradeDay = mongoose.model("NoTradeDay", noTradeDaySchema);

export { NO_TRADE_REASONS, NoTradeDay };
export default NoTradeDay;
