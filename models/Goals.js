import mongoose from "mongoose";

const goalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    tradingAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingAccount",
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    category: {
      type: String,
      enum: [
        "Performance",
        "Risk Management",
        "Discipline",
        "Psychology",
        "Consistency",
        "Journaling",
        "Custom",
      ],
      default: "Custom",
    },

    targetType: {
      type: String,
      enum: ["Percentage", "Currency", "Count", "Boolean"],
      required: true,
    },

    targetValue: {
      type: Number,
      required: true,
    },

    currentValue: {
      type: Number,
      default: 0,
    },

    unit: {
      type: String,
      default: "",
    },

    priority: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },

    status: {
      type: String,
      enum: ["Active", "Completed", "Failed", "Archived"],
      default: "Active",
    },

    startsAt: {
      type: Date,
      required: true,
    },

    endsAt: {
      type: Date,
      required: true,

      validate: {
        validator(value) {
          return value > this.startsAt;
        },
        message: "Goal end date must be after the start date.",
      },
    },

    completedAt: Date,

    notes: {
      type: String,
      maxlength: 1000,
    },
  },
  {
    timestamps: true,
  },
);

goalSchema.index({
  user: 1,
  tradingAccount: 1,
  status: 1,
});

const Goal = mongoose.model("Goal", goalSchema);

export default Goal;
