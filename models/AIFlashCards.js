import mongoose from "mongoose";

const flashcardSchema = new mongoose.Schema(
  {
    id: {
      type: Number,
      required: true,
    },

    front: {
      type: String,
      required: true,
      trim: true,
    },

    back: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      default: "General",
    },

    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Easy",
    },

    keywords: [
      {
        type: String,
      },
    ],

    tags: [
      {
        type: String,
      },
    ],
  },
  { _id: false }
);

const aiFlashcardSchema = new mongoose.Schema(
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

    topic: {
      type: String,
      required: true,
    },

    totalCards: {
      type: Number,
      required: true,
    },

    estimatedStudyTime: {
      type: Number,
      default: 15,
    },

    cards: {
      type: [flashcardSchema],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const AIFlashcard = mongoose.model("AIFlashcard", aiFlashcardSchema);

export default AIFlashcard;