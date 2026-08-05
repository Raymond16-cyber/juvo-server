import mongoose from "mongoose";

const tradingPlanSchema = new mongoose.Schema({
    accountName: {
        type: String,
        required: true,
    },
    accountNumber: {
        type: String,
        required: true,
        unique: true,
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
        min: 0,
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
        min: 0,
    },
    isConnected: {
        type: Boolean,
        default: false,
    },isArchived: {
        type: Boolean,
        default: false,
    },
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

const TradingAccount = mongoose.model("TradingAccount", tradingPlanSchema);

export default TradingAccount;