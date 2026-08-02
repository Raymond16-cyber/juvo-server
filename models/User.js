import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    avatar: {
      type: String,
      default: null,
    },
    authProvider: {
      type: String,
      enum: ["local", "apple", "google"],
      default: "local",
    },
    providerId: {
      type: String,
      default: null,
      // unique: true,
      sparse: true,
    },
    password: {
      type: String,
      required: false,
      default: null,
    },
    pushToken: {
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
    resetPasswordCode: {
      type: String,
      default: null,
    },
    tradingAccounts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TradingAccount",
      },
    ],
    journals:[
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Journal",
      }
    ],
    goals: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Goal",
      },
    ],
    behaviouralinsights: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BehaviouralInsight",
      },
    ],
    subscriptionPlan: {
      type: String,
      enum: ["free", "pro", "super"],
      default: "free",
      status: String,
      startedAt: Date,
      expiresAt: Date,
      trialEndsAt: Date,
    },
    strategy:[
      {
        type:String,
        default:null
      }
    ],
    experienceLevel: {
      type: String,
      enum: ["beginner",'intermediate',"Advanced"],
      default:"beginner",
    },
    tradingStyle: {
      type: String,
      enum: ["scalper","dayTrader","swingTrader","positionTrader"],
      default:""
    },
    country:{
      type:String,
      default:""
    },
    onboarding: {
      completed: {
        type: Boolean,
        default: false,
      },
      step: {
        type: Number,
        default: 0,
      },
    }
  },
  {
    timestamps: true,
  },
);

userSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

const User = mongoose.model("User", userSchema);
export default User;
