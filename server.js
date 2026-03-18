const express = require("express");
require("dotenv").config();
const User = require("./models/user");
const twilio = require("twilio");
const app = express();
const path = require("path");
const mongoose = require("mongoose");

// ── DB ──────────────────────────────────────────────────────────────
const mongo_uri = process.env.mongo_uri;
mongoose
  .connect(mongo_uri)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// ── Middleware ───────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ── Twilio ───────────────────────────────────────────────────────────
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ── Helper: strip any leading +91 or 91 so we never double-prefix ───
function normalizePhone(raw) {
  return String(raw)
    .trim()
    .replace(/\s+/g, "")
    .replace(/^\+91/, "")   // removes +91 prefix
    .replace(/^91(?=\d{10}$)/, ""); // removes bare 91 prefix if followed by 10 digits
}

// ── Routes ───────────────────────────────────────────────────────────
app.get("/", async (req, res) => {
  res.render("onboard");
});

// SEND OTP
app.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const cleanPhone = normalizePhone(phone);

    // Validate it's a 10-digit Indian mobile number
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10-digit Indian mobile number",
      });
    }

    // Always send OTP regardless — upsert happens on verify
    const verification = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({
        to: `+91${cleanPhone}`,
        channel: "sms",
      });

    return res.json({
      success: true,
      message: "OTP sent successfully",
      status: verification.status,
    });
  } catch (error) {
    console.error("Send OTP Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP. Please try again.",
      error: error.message,
    });
  }
});

// VERIFY OTP + REGISTER
app.post("/verify-otp-and-register", async (req, res) => {
  try {
    const { username, phone, otp } = req.body;

    if (!username || !phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Name, phone, and OTP are all required",
      });
    }

    const cleanPhone = normalizePhone(phone);

    // Validate phone again server-side
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format",
      });
    }

    // Verify OTP with Twilio first
    const verificationCheck = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({
        to: `+91${cleanPhone}`,
        code: otp,
      });

    if (verificationCheck.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP. Please try again.",
      });
    }

    // Check if user already exists AND is already registered at this building
    const existingUser = await User.findOne({ phone: cleanPhone });
    if (existingUser && existingUser.building === "Harsha AVK") {
      return res.status(200).json({
        success: false,
        alreadyRegistered: true,
        message: "You are already registered at Harsha AVK.",
      });
    }

    // Upsert: update existing user (different/no building) OR create new one
    const user = await User.findOneAndUpdate(
      { phone: cleanPhone },
      {
        $set: {
          username: username.trim(),
          building: "Harsha AVK",
          isPhoneVerified: true,
          verified: true,
          role: "user",
        },
        $setOnInsert: {
          phone: cleanPhone,
        },
      },
      {
        upsert: true,       // create if not found
        new: true,          // return updated doc
        runValidators: true,
      }
    );

    return res.status(200).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: user._id,
        username: user.username,
        phone: user.phone,
        building: user.building,
      },
    });
  } catch (error) {
    console.error("Verify/Register Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
      error: error.message,
    });
  }
});

// ── Start ────────────────────────────────────────────────────────────
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
