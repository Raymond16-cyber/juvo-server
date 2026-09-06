import "./loadEnv.js";
import mongoose from "mongoose";



const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/juvo";
const isProduction = process.env.NODE_ENV === "production";
const mongoUrl = process.env.MONGO_URL;
export default async function connectDb() {
  if (isProduction && !mongoUrl) {
    throw new Error("MONGO_URL is required in production.");
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(isProduction ? mongoUrl : mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    const { default: Journal } = await import("../models/Journal.js");
    await Journal.collection.dropIndex("user_1_tradingAccount_1_journalDate_1");
  } catch {
    // Index already matches one journal per day.
  }

  try {
    const { default: TradingAccount } = await import(
      "../models/tradingAccounts.js"
    );
    await TradingAccount.collection.dropIndex("accountNumber_1");
  } catch {
    // Index already matches per-user account uniqueness.
  }
}

