import mongoose from "mongoose";

const tradeSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    instrument: {
      type: String,
      enum: ["forex", "stocks", "crypto", "commodities", "indices","others"],
      required: true,
    },

    direction: {
      type: String,
      enum: ["long", "short"],
      required: true,
    },

    entryPrice: {
      type: Number,
      required: true,
    },

    exitPrice: {
      type: Number,
    },

    stopLoss: {
      type: Number,
      required: true,
    },

    takeProfit: {
      type: Number,
      required: true,
    },

    lotSize: {
      type: Number,
      required: true,
    },

    riskPercentage: {
      type: Number,
      required: true,
    },

    plannedRR: {
      type: Number,
      required: true,
    },

    achievedRR: Number,

    profitLoss: {
      type: Number,
      default: 0,
    },

    pips: Number,

    status: {
      type: String,
      enum: ["Open", "Closed", "Breakeven", "Cancelled"],
      default: "Open",
    },

    session: {
      type: String,
      enum: ["Asian", "Tokyo", "London", "New York"],
    },

    openedAt: Date,

    closedAt: Date,

    screenshots: [
      {
        type: String,
      },
    ],

    notes: String,
  },
  {
    _id: true,
  },
);

const Trade = mongoose.model("Trade", tradeSchema);

export default Trade;