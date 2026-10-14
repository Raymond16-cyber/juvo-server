import mongoose from "mongoose";

const tradeSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },

    tradingAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingAccount",
      required: true,
      index: true,
    },

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
      required() { return this.source !== "metatrader"; },
    },

    takeProfit: {
      type: Number,
      required() { return this.source !== "metatrader"; },
    },

    lotSize: {
      type: Number,
      required: true,
    },

    riskPercentage: {
      type: Number,
      required() { return this.source !== "metatrader"; },
    },

    plannedRR: {
      type: Number,
      required() { return this.source !== "metatrader"; },
    },

    achievedRR: Number,

    profitLoss: {
      type: Number,
      default: 0,
    },

    profitLossCurrency: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
    },

    normalizedProfitLoss: {
      amount: Number,
      currency: {
        type: String,
        uppercase: true,
        trim: true,
      },
      rate: Number,
      rateAt: Date,
      source: String,
      unavailableReason: String,
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

    source: {
      type: String,
      enum: ["manual", "ctrader", "metatrader"],
      default: "manual",
      index: true,
    },

    externalId: {
      type: String,
      trim: true,
      index: true,
    },

    externalPositionId: {
      type: String,
      trim: true,
    },

    externalOrderId: {
      type: String,
      trim: true,
    },

    brokerConnection: { type: mongoose.Schema.Types.ObjectId, ref: "BrokerConnection" },
    platform: String,
    externalDealId: String,
    commission: Number,
    swap: Number,
    fee: Number,
    brokerMetadata: { magic: String, comment: String, origin: String, partialClose: Boolean },

    rawSource: {
      type: mongoose.Schema.Types.Mixed,
      select: false,
    },
  },
  {
    _id: true,
    autoIndex: false,
  },
);

tradeSchema.index(
  { user: 1, source: 1, externalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      source: "ctrader",
      externalId: { $type: "string" },
    },
  },
);

tradeSchema.index({ user: 1, source: 1, externalId: 1 }, {
  name: "metatrader_trade_identity", unique: true,
  partialFilterExpression: { source: "metatrader", externalId: { $type: "string" } },
});

const Trade = mongoose.model("Trade", tradeSchema);

export default Trade;
