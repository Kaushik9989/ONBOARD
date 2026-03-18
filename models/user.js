const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const walletSchema = new mongoose.Schema(
  {
    credits: { type: Number, default: 0 },
    totalSpent: { type: mongoose.Decimal128, default: 0 },
    autoReload: { type: Boolean, default: false },
    autoReloadAmount: { type: Number, default: 50 },
    autoReloadThreshold: { type: Number, default: 10 },
  },
  { _id: false }
);

const subscriptionSchema = new mongoose.Schema(
  {
    planId: String,
    status: { type: String, default: "active" },
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: { type: Boolean, default: false },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    password: { type: String },
    googleId: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    email: { type: String, unique: true, sparse: true },
    isPhoneVerified: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    building: [{
      type: String,
      required: false,
      trim: true,
    }],
    role: {
      type: String,
      enum: ["user", "admin", "technician", "partner"],
      default: "user",
    },
    lastLogin: { type: Date, default: null },
    parcels: [{ type: mongoose.Schema.Types.ObjectId, ref: "Parcel" }],
    wallet: {
      type: walletSchema,
      default: () => ({}),
    },
    subscription: {
      type: subscriptionSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

// ── Static helper: hash a password manually ──────────────────────────
// Usage before creating a password-based user:
//   const hashed = await User.hashPassword("plaintext");
//   await User.create({ password: hashed, ... });
userSchema.statics.hashPassword = async function (plaintext) {
  return bcrypt.hash(plaintext, 12);
};

// ── Instance method: verify a password ──────────────────────────────
userSchema.methods.comparePassword = function (candidatePassword) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);