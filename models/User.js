import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // Authentication
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    password: {
      type: String,
      default: null,
    },

    authProvider: {
      type: String,
      enum: ["local", "google", "apple"],
      default: "local",
    },

    providerId: {
      type: String,
      default: null,
      sparse: true,
    },

    avatar: {
      type: String,
      default: null,
    },

    // Profile
    profile: {
      country: {
        type: String,
        default: "",
      },

      timezone: {
        type: String,
        default: "UTC",
      },

      experienceLevel: {
        type: String,
        enum: ["beginner", "intermediate", "advanced"],
        default: "beginner",
      },

      tradingStyle: {
        type: String,
        enum: ["scalper", "dayTrader", "swingTrader", "positionTrader"],
      },

      instruments: [
        {
          type: String,
          enum: ["forex", "stocks", "crypto", "commodities", "indices"],
        },
      ],

      biggestChallenges: [
        {
          type: String,
          enum: [
            "FOMO",
            "Overtrading",
            "Lack of Discipline",
            "Lack of Patience",
            "Fear",
            "Greed",
            "Moving Stop Loss",
            "Closing Winners Too Early",
            "Other",
          ],
        },
      ],
    },

    // Preferences
    preferences: {
      theme: {
        type: String,
        enum: ["light", "dark", "system"],
        default: "system",
      },

      preferredCurrency: {
        type: String,
        default: "USD",
      },

      weekStartsOn: {
        type: String,
        enum: ["Sunday", "Monday"],
        default: "Monday",
      },

      notifications: {
        enabled: {
          type: Boolean,
          default: true,
        },

        reminderTime: {
          type: String,
          default: "08:00",
        },

        pushToken: {
          type: String,
          default: null,
        },
      },
    },

    // Subscription
    subscription: {
      plan: {
        type: String,
        enum: ["free", "pro", "super"],
        default: "free",
      },

      status: {
        type: String,
        enum: ["trial", "active", "expired", "cancelled"],
        default: "trial",
      },

      startedAt: Date,

      expiresAt: Date,

      trialEndsAt: Date,
    },

    // Security
    security: {
      otpVerificationToken: {
        type: String,
        default: null,
      },
      otpVerificationExpires: {
        type: Date,
        default: null,
      },
      otpVerificationRequestedAt: {
        type: Date,
        default: null,
      },

      otpVerificationCode: {
        type: String,
        default: null,
      },
      resetPasswordToken: {
        type: String,
        default: null,
      },

      resetPasswordExpires: {
        type: Date,
        default: null,
      },

      resetPasswordRequestedAt: {
        type: Date,
        default: null,
      },
      resetPasswordVerified: {
        type: Boolean,
        default: false,
      },

      emailVerified: {
        type: Boolean,
        default: false,
      },

      lastLogin: Date,
    },

    // Onboarding
    onboarding: {
      completed: {
        type: Boolean,
        default: false,
      },

      currentStep: {
        type: Number,
        default: 0,
      },

      completedAt: Date,
    },

    // To be cached for performance optimization
    stats: {
      currentJournalStreak: {
        type: Number,
        default: 0,
      },

      longestJournalStreak: {
        type: Number,
        default: 0,
      },

      totalTrades: {
        type: Number,
        default: 0,
      },

      totalJournals: {
        type: Number,
        default: 0,
      },
    },
    // Activity
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = ret._id;

    delete ret._id;
    delete ret.__v;
    delete ret.password;
    delete ret.security.resetPasswordToken;
    delete ret.security.resetPasswordCode;

    return ret;
  },
});

const User = mongoose.model("User", userSchema);

export default User;
