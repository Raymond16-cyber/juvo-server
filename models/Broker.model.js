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
      enum: ["ctrader", "metaapi"],
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

    status: {
      type: String,
      enum: [
        "connecting",
        "connected",
        "disconnected",
        "error",
        "reauthorization_required",
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
    return ret;
  },
});

const BrokerConnection = mongoose.model(
  "BrokerConnection",
  BrokerConnectionSchema,
);

export default BrokerConnection;
