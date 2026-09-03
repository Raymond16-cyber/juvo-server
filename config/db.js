import "./loadEnv.js";
import mongoose from "mongoose";



const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/juvo";
export default async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(mongoUri);

  try {
    const { default: Journal } = await import("../models/Journal.js");
    await Journal.collection.dropIndex("user_1_tradingAccount_1_journalDate_1");
  } catch {
    // Index already matches one journal per day.
  }
}

