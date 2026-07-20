import mongoose from "mongoose";

const studySetSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    author: {
      type: String,
      required: true,
      trim: true,
    },
    flashcardCount: {
      type: Number,
      default: 0,
    },
    quizCount: {
      type: Number,  
      default: 0,
    },
    quizzes:[
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AIQuiz",
      }
    ],
    noteCount: {
      type: Number,
      default: 0,
    },
    accent: {
      type: String,
      default: "#06B6D4",
    },
    rating: {
      type: Number,
      default: 0,
    },
    isPublic: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

studySetSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

const StudySet = mongoose.model("StudySet", studySetSchema);
export default StudySet;
