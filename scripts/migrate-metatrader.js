import "../config/loadEnv.js";
import mongoose from "mongoose";
import { migrateLegacyMetaApi } from "../brokers/metatrader/metatrader.migration.js";

const apply = process.argv.includes("--apply");
try {
  const uri = process.env.NODE_ENV === "production" ? process.env.MONGO_URL : process.env.MONGO_URI || "mongodb://localhost:27017/juvo";
  if (!uri) throw new Error("Database configuration missing");
  await mongoose.connect(uri, { autoIndex: false });
  const counts = await migrateLegacyMetaApi({ dryRun: !apply });
  console.log(JSON.stringify({ dryRun: !apply, ...counts }));
} catch {
  console.error("MetaTrader migration could not complete. Check database connectivity and indexes; no credentials are printed.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
