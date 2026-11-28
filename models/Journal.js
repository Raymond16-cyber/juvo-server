import mongoose from "mongoose";

const journalSchema = new mongoose.Schema(
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

    tradingPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingPlan",
    },

    tradingStrategy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradingStrategy",
    },

    journalDate: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["Started", "Completed"],
      default: "Started",
    },

    // Set when the nightly job auto-closes an open journal after local midnight.
    autoClosedAt: {
      type: Date,
      default: null,
    },

    autoCloseReason: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },

    trades: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Trade",
      },
    ],

    psychology: {
      beforeTrading: {
        type: String,
      },

      afterTrading: {
        type: String,
      },

      confidenceBefore: {
        type: Number,
        min: 1,
        max: 10,
      },

      confidenceAfter: {
        type: Number,
        min: 1,
        max: 10,
      },
      beforeTradingAudio: {
        publicId: { type: String },
        format: { type: String },
        bytes: { type: Number },
        duration: { type: Number },
      },
    },

    review: {
      biggestMistake: String,

      biggestWin: String,

      lessonLearned: String,

      improvementsTomorrow: String,

      overallThoughts: String,
    },

    discipline: {
      followedTradingPlan: {
        type: Boolean,
      },

      followedRiskManagement: {
        type: Boolean,
      },

      revengeTraded: {
        type: Boolean,
      },

      overTraded: {
        type: Boolean,
      },

      respectedStopLoss: {
        type: Boolean,
      },

      score: {
        type: Number,
        min: 0,
        max: 100,
      },
    },

    ai: {
      feedback: String,

      summary: String,

      interviewer: {
        questions: [String],
        contentHash: String,
        generatedAt: Date,
      },
    },

    // Snapshot of plan-compliance evaluation for the plan version in force.
    planCompliance: {
      planId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TradingPlan",
        default: null,
      },
      planKey: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      planVersion: {
        type: Number,
        default: null,
      },
      evaluatedAt: {
        type: Date,
        default: null,
      },
      score: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
      },
      counts: {
        followed: { type: Number, default: 0 },
        violated: { type: Number, default: 0 },
        unknown: { type: Number, default: 0 },
        needs_confirmation: { type: Number, default: 0 },
        not_applicable: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
        notConfigured: { type: Number, default: 0 },
        notRecorded: { type: Number, default: 0 },
      },
      checks: [
        {
          ruleId: { type: mongoose.Schema.Types.ObjectId, default: null },
          label: { type: String, trim: true, maxlength: 80 },
          title: { type: String, trim: true, maxlength: 160 },
          category: { type: String, trim: true, maxlength: 40 },
          status: {
            type: String,
            enum: [
              "followed",
              "violated",
              "unknown",
              "needs_confirmation",
              "not_applicable",
              "not_configured",
              "not_recorded",
            ],
          },
          evidence: { type: String, trim: true, maxlength: 500 },
          source: {
            type: String,
            enum: ["auto", "manual", "ai"],
            default: "auto",
          },
          manualNote: { type: String, trim: true, maxlength: 500, default: "" },
          updatedAt: { type: Date, default: Date.now },
          updatedBy: {
            type: String,
            enum: ["system", "user"],
            default: "system",
          },
        },
      ],
      interpretation: { type: String, trim: true, maxlength: 2000, default: "" },
      question: { type: String, trim: true, maxlength: 500, default: "" },
      methodology: {
        type: String,
        trim: true,
        maxlength: 500,
        default:
          "Score = followed / (followed + violated). Unknown, not applicable, not configured, and not recorded checks are excluded.",
      },
    },

    behaviourFlags: [
      {
        challenge: {
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
            "overconfidence",
          ],
          required: true,
        },
        source: {
          type: String,
          enum: ["auto", "manual"],
          default: "auto",
        },
        confidence: {
          type: Number,
          min: 0,
          max: 1,
          default: 0.5,
        },
        confirmed: {
          type: Boolean,
          default: null,
        },
        dismissedAt: {
          type: Date,
          default: null,
        },
        evidence: {
          kind: { type: String, trim: true, maxlength: 60 },
          description: { type: String, trim: true, maxlength: 300 },
          observedAt: Date,
          metrics: mongoose.Schema.Types.Mixed,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);

journalSchema.index(
  {
    user: 1,
    journalDate: 1,
  },
  {
    unique: true,
  },
);

const Journal = mongoose.model("Journal", journalSchema);

export default Journal;
