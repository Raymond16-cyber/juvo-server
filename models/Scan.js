import mongoose from "mongoose";

const scanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["document", "ocr"],
      default: "document",
    },
    text: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

scanSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const Scan = mongoose.model("Scan", scanSchema);
export default Scan;
