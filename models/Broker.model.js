import mongoose from "mongoose";

const { Schema } = mongoose;

const BrokerConnectionSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  provider: {
    type: String,
    enum: ["ctrader", "metaapi"],
    required: true,
  },

  platform: {
    type: String,
    enum: ["ctrader", "mt4", "mt5"],
    required: true,
  },

  externalAccountId: String,

  brokerName: String,

  accountNumber: String,

  accountType: {
    type: String,
    enum: ["demo", "live"],
  },

  accessToken: String,
  refreshToken: String,

  status: {
    type: String,
    enum: ["connecting", "connected", "disconnected", "error"],
    default: "connecting",
  },

  lastSyncedAt: Date,
});
