import mongoose from "mongoose";

const tradingStrategySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    prerequisites: [
      {
        type: String,
        required: false,
      },
    ],
    timeframe: [
      {
        type: String,
        enum: [
          "1m",
          "3m",
          "5m",
          "15m",
          "30m",
          "1h",
          "4h",
          "1d",
          "1w",
          "1M",
          "1Y",
        ],
        required: false,
      },
    ],
    session: [
      {
        type: String,
        enum: ["Asian", "Sydney", "Tokyo", "London", "New York"],
        required: false,
      },
    ],
    notes: {
      type: String,
      required: false,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

const TradingStrategy = mongoose.model(
  "TradingStrategy",
  tradingStrategySchema,
);

export default TradingStrategy;
