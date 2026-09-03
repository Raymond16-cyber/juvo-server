import "./loadEnv.js";
import mongoose from "mongoose";



const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/juvo";
const isProduction = process.env.NODE_ENV === "production";
const mongoUrl = process.env.MONGO_URL || "mongodb+srv://Raymond17:2xGjtsHCqigXSpzc@clustergomycode.7pynx6y.mongodb.net/juvo?retryWrites=true&w=majority";
export default async function connectDb() {
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
}

