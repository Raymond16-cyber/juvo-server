import mongoose from "mongoose";

const userAchievementSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    achievementId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    earnedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    // Snapshot of progress at award time for audit / criteria versioning.
    progressAtAward: {
      type: Number,
      default: null,
    },

    thresholdAtAward: {
      type: Number,
      default: null,
    },

    criteriaVersion: {
      type: Number,
      default: 1,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Client celebration already shown for this award.
    celebratedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

userAchievementSchema.index(
  { user: 1, achievementId: 1 },
  { unique: true, name: "user_achievement_unique" },
);

userAchievementSchema.index({ user: 1, earnedAt: -1 });

const UserAchievement = mongoose.model("UserAchievement", userAchievementSchema);

export default UserAchievement;
