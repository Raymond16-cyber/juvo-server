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
    authProvider: {
      type: String,
      enum: ["local", "apple"],
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
  },
  {
    timestamps: true,
  }
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

const User  = mongoose.model("User", userSchema);
export default User;