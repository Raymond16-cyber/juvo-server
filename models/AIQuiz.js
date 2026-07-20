import mongoose from "mongoose";

const OptionSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const QuestionSchema = new mongoose.Schema(
  {
    id: Number,

    question: {
      type: String,
      required: true,
    },

    difficulty: {
      type: String,
      default: "Easy",
    },

    options: {
      type: [OptionSchema],
      required: true,
    },

    // "A", "B", "C", or "D"
    correctAnswer: {
      type: String,
      required: true,
    },

    explanation: String,

    points: {
      type: Number,
      default: 1,
    },
  },
  { _id: false }
);

const QuizSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    topic: String,
    difficulty: String,
    estimatedTime: Number,
    totalQuestions: Number,
    questions: [QuestionSchema],
  },
  {
    timestamps: true,
  }
);

const aiQuiz = mongoose.model("AIQuiz", QuizSchema);

export default aiQuiz;