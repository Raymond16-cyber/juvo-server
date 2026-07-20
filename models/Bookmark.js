import mongoose from "mongoose";

const bookmarkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    studySetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudySet",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

bookmarkSchema.index({ userId: 1, studySetId: 1 }, { unique: true });

bookmarkSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const Bookmark = mongoose.model("Bookmark", bookmarkSchema);
export default Bookmark;
