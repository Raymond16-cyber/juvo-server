import mongoose from "mongoose";
const schema = new mongoose.Schema({
  brokerConnection: { type: mongoose.Schema.Types.ObjectId, required: true },
  syncId: { type: String, required: true },
  start: Number, end: Number, pageCount: Number,
  pages: [Number],
  completedAt: Date,
  expiresAt: { type: Date, required: true, expires: 0 },
});
schema.index({ brokerConnection: 1, syncId: 1 }, { unique: true });
export default mongoose.model("ConnectorHistorySync", schema);
