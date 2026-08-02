import mongoose from "mongoose";



const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/juvo";
export default async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(mongoUri);
}

