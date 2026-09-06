import mongoose from "mongoose";

const BrokerPositionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    tradingAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingAccount",
      required: true,
      index: true,
    },

    brokerConnection: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BrokerConnection",
      index: true,
    },

    provider: {
      type: String,
      enum: ["ctrader"],
      required: true,
      default: "ctrader",
      index: true,
    },

    ctidTraderAccountId: {
      type: String,
      required: true,
      index: true,
    },

    externalPositionId: {
      type: String,
      required: true,
      index: true,
    },

    symbol: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    symbolId: String,

    direction: {
      type: String,
      enum: ["long", "short"],
      required: true,
    },

    volume: Number,
    lotSize: Number,
    entryPrice: Number,
    stopLoss: Number,
    takeProfit: Number,
    swap: Number,
    commission: Number,
    usedMargin: Number,

    status: {
      type: String,
      enum: ["open", "closed", "unknown"],
      default: "open",
      index: true,
    },

    openedAt: Date,
    brokerUpdatedAt: Date,
    syncedAt: Date,
    closedAt: Date,
    label: String,
    comment: String,

    rawSource: {
      type: mongoose.Schema.Types.Mixed,
      select: false,
    },
  },
  {
    timestamps: true,
  },
);

BrokerPositionSchema.index(
  {
    userId: 1,
    provider: 1,
    ctidTraderAccountId: 1,
    externalPositionId: 1,
  },
  { unique: true },
);

const BrokerPosition = mongoose.model("BrokerPosition", BrokerPositionSchema);

export default BrokerPosition;
