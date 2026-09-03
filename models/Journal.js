import mongoose from "mongoose";

const journalSchema = new mongoose.Schema(
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
      required: true,
    },

    tradingPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingPlan",
    },

    tradingStrategy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingStrategy",
    },

    journalDate: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["Started", "Completed"],
      default: "Started",
    },

    trades: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Trade",
      },
    ],

    psychology: {
      beforeTrading: {
        type: String,
      },

      afterTrading: {
        type: String,
      },

      confidenceBefore: {
        type: Number,
        min: 1,
        max: 10,
      },

      confidenceAfter: {
        type: Number,
        min: 1,
        max: 10,
      },
    },

    review: {
      biggestMistake: String,

      biggestWin: String,

      lessonLearned: String,

      improvementsTomorrow: String,

      overallThoughts: String,
    },

    discipline: {
      followedTradingPlan: {
        type: Boolean,
      },

      followedRiskManagement: {
        type: Boolean,
      },

      revengeTraded: {
        type: Boolean,
      },

      overTraded: {
        type: Boolean,
      },

      respectedStopLoss: {
        type: Boolean,
      },

      score: {
        type: Number,
        min: 0,
        max: 100,
      },
    },

    ai: {
      feedback: String,

      summary: String,
    },
  },
  {
    timestamps: true,
  },
);

journalSchema.index(
  {
    user: 1,
    journalDate: 1,
  },
  {
    unique: true,
  },
);

const Journal = mongoose.model("Journal", journalSchema);

export default Journal;
