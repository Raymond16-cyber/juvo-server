import "./loadEnv.js";
import mongoose from "mongoose";
import { ensureTradeIndexes } from "./tradeIndexes.js";

const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/juvo";
const isProduction = process.env.NODE_ENV === "production";
const mongoUrl = process.env.MONGO_URL;
export default async function connectDb() {
  if (isProduction && !mongoUrl) {
    throw new Error("MONGO_URL is required in production.");
  }

  mongoose.set("strictQuery", true);
  await mongoose
    .connect(isProduction ? mongoUrl : mongoUri)
    .then(() => console.log("Database Connection Successful🍃"))
    .catch((error) => console.log(error));

  try {
    const { default: Journal } = await import("../models/Journal.js");
    await Journal.collection.dropIndex("user_1_tradingAccount_1_journalDate_1");
  } catch {
    // Index already matches one journal per day.
  }

  try {
    const { default: TradingAccount } =
      await import("../models/tradingAccounts.js");
    await TradingAccount.collection.dropIndex("accountNumber_1");
  } catch {
    // Index already matches per-user account uniqueness.
  }

  try {
    const { default: TradingPlan } = await import("../models/tradingPlan.js");
    // Replace legacy unique(userId, tradingAccount, status) so archived versions can coexist.
    await TradingPlan.collection.dropIndex("userId_1_tradingAccount_1_status_1");
  } catch {
    // Partial unique active-plan index is defined on the model.
  }

  try {
    const { default: TradingPlan } = await import("../models/tradingPlan.js");
    await TradingPlan.syncIndexes();
  } catch (error) {
    console.warn("TradingPlan index sync skipped:", error?.message || error);
  }

  await ensureTradeIndexes();
}
