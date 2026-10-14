import mongoose from "mongoose";
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  codeHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true, expires: 0 },
  consumedAt: Date,
  attemptHash: { type: String, select: false },
  accountKey: { type: String, select: false },
}, { timestamps: true });
export default mongoose.model("ConnectorPairing", schema);
