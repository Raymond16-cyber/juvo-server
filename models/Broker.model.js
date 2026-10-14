import crypto from "crypto";
import mongoose from "mongoose";

const { Schema } = mongoose;

function encryptionKey() {
  const secret =
    process.env.BROKER_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("BROKER_TOKEN_ENCRYPTION_KEY or JWT_SECRET is required.");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

function encryptToken(value) {
  if (!value) return value;
  if (String(value).startsWith("enc:")) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "enc",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

function decryptToken(value) {
  if (!value) return value;
  const parts = String(value).split(":");
  if (parts.length !== 4 || parts[0] !== "enc") return value;

  const [, iv, tag, encrypted] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

const BrokerConnectionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    provider: {
      type: String,
      enum: ["ctrader", "metatrader"],
      required: true,
    },

    platform: {
      type: String,
      enum: ["ctrader", "mt4", "mt5"],
      required: true,
    },

    externalAccountId: {
      type: String,
      trim: true,
    },

    brokerName: {
      type: String,
      trim: true,
    },

    accountNumber: {
      type: String,
      trim: true,
    },

    accountType: {
      type: String,
      enum: ["demo", "live"],
    },

    accessToken: {
      type: String,
      select: false,
      set: encryptToken,
    },

    refreshToken: {
      type: String,
      select: false,
      set: encryptToken,
    },

    tokenExpiresAt: Date,

    tradingAccount: { type: Schema.Types.ObjectId, ref: "TradingAccount" },
    server: { type: String, trim: true },
    accountCurrency: String,
    desiredConnected: { type: Boolean, default: false },
    lastError: { code: String, message: String },
    historySyncedAt: Date,
    externalAccountKey: { type: String, select: false },
    connectorTokenHash: { type: String, select: false },
    pairingId: { type: Schema.Types.ObjectId, select: false },
    pairedAt: Date,
    revokedAt: Date,
    lastHeartbeatAt: Date,
    terminalConnected: Boolean,
    connectorVersion: String,
    protocolVersion: Number,
    historyCursor: { type: Number, default: 0 },
    syncRequestedAt: Date,
    legacy: { type: Boolean, default: false },
    legacyResourceId: { type: String, select: false },

    status: {
      type: String,
      enum: [
        "connecting",
        "connected",
        "disconnected",
        "error",
        "reauthorization_required",
        "synchronizing", "stale", "offline",
      ],
      default: "connecting",
      index: true,
    },

    lastSyncedAt: Date,
    connectedAt: Date,
  },
  {
    timestamps: true,
  },
);

BrokerConnectionSchema.index({
  userId: 1,
  provider: 1,
  externalAccountId: 1,
});

BrokerConnectionSchema.index({ userId: 1, provider: 1, externalAccountKey: 1 }, {
  unique: true, partialFilterExpression: { provider: "metatrader", externalAccountKey: { $type: "string" } },
});
BrokerConnectionSchema.index({ connectorTokenHash: 1 }, { unique: true, sparse: true });
BrokerConnectionSchema.index({ userId: 1, provider: 1, tradingAccount: 1 }, {
  name: "juvo_mt5_active_binding", unique: true,
  partialFilterExpression: { provider: "metatrader", desiredConnected: true, tradingAccount: { $type: "objectId" } },
});

BrokerConnectionSchema.methods.getAccessToken = function getAccessToken() {
  return decryptToken(this.accessToken);
};

BrokerConnectionSchema.methods.getRefreshToken = function getRefreshToken() {
  return decryptToken(this.refreshToken);
};

BrokerConnectionSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.accessToken;
    delete ret.refreshToken;
    for (const key of ["externalAccountKey", "connectorTokenHash", "pairingId", "legacyResourceId"]) delete ret[key];
    if (ret.provider === "metatrader") {
      delete ret.externalAccountId;
      ret.accountNumber = ret.accountNumber ? `****${ret.accountNumber.slice(-4)}` : undefined;
    }
    return ret;
  },
});

const BrokerConnection = mongoose.model(
  "BrokerConnection",
  BrokerConnectionSchema,
);

export default BrokerConnection;
