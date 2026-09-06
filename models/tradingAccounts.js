import mongoose from "mongoose";

const tradingAccountSchema = new mongoose.Schema({
    accountName: {
        type: String,
        required: true,
    },
    accountNumber: {
        type: String,
        required: true,
    },
    accountType: {
        type: String,
        required: true,
        enum: ["live", "demo", "prop", "challenge"]
    },
    broker: {
        type: String,
        required: true,
    },
    initialBalance: {
        type: Number,
        required: true,
        min: 0,
    },
    currentBalance: {
        type: Number,
        required: true,
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    platform: {
        type: String,
        required: true
    },
    server: {
        type: String,
    },
    leverage: {
        type: String,
        required: true,
    },
    currency: {
        type: String,
        required: true,
    },
    currentEquity: {
        type: Number,
        required: true,
    },
    maxDrawnDown: {    // Maximum Drawdown in percentage
        type: Number,
        required: true,
        min: 0
    },
    profitTarget: {     // Profit target in percentage
        type: Number,
        required: true,
        min: 0
    },
    isConnected: {
        type: Boolean,
        default: false,
    },
    isArchived: {
        type: Boolean,
        default: false,
    },
    isActive: {
        type: Boolean,
        default: false,
        index: true,
    },
    status: {
        type: String,
        enum: ["Active", "Passed", "Breached"],
        default: "Active",
        index: true,
    },
    statusUpdatedAt: {
        type: Date,
        default: null,
    },
    trades: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Trade",
        },
    ],
    lastSyncedAt: {
        type: Date,
        default: null,
    },
    validFrom: {
        type: Date,
    },
    validUntil: {
        type: Date,
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
    },
    tradingPlan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TradingPlan",
    },
}, {
    timestamps: true,
});

tradingAccountSchema.index(
    { userId: 1, accountNumber: 1, broker: 1, platform: 1 },
    { unique: true },
);
tradingAccountSchema.index({ userId: 1, isActive: 1 });
tradingAccountSchema.index({ userId: 1, status: 1 });

const TradingAccount = mongoose.model("TradingAccount", tradingAccountSchema);

export default TradingAccount;

// This schema represents a trading account with various attributes such as account details, broker information, balance, user association, and trading parameters. It includes validation rules for certain fields and references to related models like User, TradingStrategy, and TradingPlan.
