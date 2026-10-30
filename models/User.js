import mongoose from "mongoose";



const dashboardGuideSchema = new mongoose.Schema(
  {
    version: {
      type: Number,
      default: 1,
    },

    dismissedHints: {
      type: [String],
      default: [],
    },

    completedChecklist: {
      type: [String],
      default: [],
    },

    tourCompleted: {
      type: Boolean,
      default: false,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  },
);


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

    // Authorization role — admins bypass private beta restrictions.
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      index: true,
    },

    // Private beta tester window (separate from waitlist invitations).
    betaAccess: {
      status: {
        type: String,
        enum: ["none", "active", "expired", "revoked"],
        default: "none",
        index: true,
      },
      activatedAt: {
        type: Date,
        default: null,
      },
      expiresAt: {
        type: Date,
        default: null,
        index: true,
      },
      grantedAt: {
        type: Date,
        default: null,
      },
      codeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BetaTesterCode",
        default: null,
      },
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
        enum: ["beginner", "intermediate", "advanced", "professional"],
        default: "beginner",
      },

      tradingStyle: {
        type: String,
        enum: ["scalping", "day_trading", "swing_trading", "position_trading"],
        default: "day_trading",
      },

      instruments: [
        {
          type: String,
          enum: [
            "forex",
            "crypto",
            "stocks",
            "indices",
            "commodities",
            "futures",
          ],
        },
      ],
      biggestChallenges: [
        {
          type: String,
          enum: [
            "fomo",
            "revenge_trading",
            "overtrading",
            "impatience",
            "poor_risk_management",
            "emotional_trading",
            "lack_of_discipline",
            "inconsistent_strategy",
          ],
        },
      ],

      // Up to three earned achievement ids shown on the user's own profile.
      featuredAchievements: {
        type: [String],
        default: [],
        validate: {
          validator(value) {
            return !Array.isArray(value) || value.length <= 3;
          },
          message: "You can feature up to three achievements.",
        },
      },
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

      reportingCurrency: {
        type: String,
        uppercase: true,
        trim: true,
        default: "USD",
      },

      weekStartsOn: {
        type: String,
        enum: ["sunday", "monday"],
        default: "monday",
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

      aiCheckins: {
        enabled: {
          type: Boolean,
          default: false,
        },
        lastSentAt: {
          type: Date,
          default: null,
        },
        cooldownHours: {
          type: Number,
          default: 24,
          min: 1,
          max: 168,
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
        enum: [
          "free",
          "pending",
          "trial",
          "active",
          "non-renewing",
          "past-due",
          "expired",
          "cancelled",
        ],
        default: "free",
      },

      startedAt: Date,

      expiresAt: Date,

      trialEndsAt: Date,
    },

    // Product entitlements that are separate from the main subscription plan.
    entitlements: {
      aiTrial: {
        status: {
          type: String,
          enum: ["available", "active", "expired"],
          default: "available",
        },
        startedAt: Date,
        expiresAt: Date,
        used: {
          type: Boolean,
          default: false,
        },
      },
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
      isOtpVerified: {
        type: Boolean,
        default: false,
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

      emailVerificationToken: {
        type: String,
        default: null,
        select: false,
      },

      emailVerificationExpires: {
        type: Date,
        default: null,
        select: false,
      },
      emailVerificationTokenUsedHash: {
        type: String,
        default: null,
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

    dashboardGuide: {
      type: dashboardGuideSchema,
      default: () => ({}),
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

      lastQualifyingJournalDayKey: {
        type: String,
        default: null,
        trim: true,
      },

      lastQualifyingJournalAt: {
        type: Date,
        default: null,
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
    if (ret.security) {
      delete ret.security.otpVerificationToken;
      delete ret.security.otpVerificationCode;
      delete ret.security.resetPasswordToken;
      delete ret.security.resetPasswordCode;
    }

    return ret;
  },
});



const User = mongoose.model("User", userSchema);

export default User;
