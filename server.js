const express = require("express");
require("dotenv").config();
const User = require("./models/user");
const twilio = require("twilio");
const app = express();
const path = require("path");
const mongoose = require("mongoose");

mongoose
  .connect(process.env.mongo_uri)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

function normalizePhone(raw) {
  return String(raw).trim().replace(/\s+/g, "")
    .replace(/^\+91/, "")
    .replace(/^91(?=\d{10}$)/, "");
}

app.get("/", async (req, res) => res.render("onboard"));
app.get("/avk-harsha", async (req, res) => res.render("onboard"));

// SEND OTP
app.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "Phone number is required" });

    const cleanPhone = normalizePhone(phone);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: "Please enter a valid 10-digit Indian mobile number" });
    }

    const verification = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: `+91${cleanPhone}`, channel: "sms" });

    return res.json({ success: true, message: "OTP sent successfully", status: verification.status });
  } catch (error) {
    console.error("Send OTP Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to send OTP. Please try again.", error: error.message });
  }
});

// VERIFY OTP — checks if user exists, returns existing user info or signals new user
app.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ success: false, message: "Phone and OTP are required" });

    const cleanPhone = normalizePhone(phone);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: "Invalid phone number format" });
    }

    // Verify OTP with Twilio
    const verificationCheck = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: `+91${cleanPhone}`, code: otp });

    if (verificationCheck.status !== "approved") {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP. Please try again." });
    }

    const THIS_BUILDING = "AVK Harsha";
    const existingUser = await User.findOne({ phone: cleanPhone });

    if (existingUser) {
      const buildings = Array.isArray(existingUser.building)
        ? existingUser.building
        : existingUser.building ? [existingUser.building] : [];

      const alreadyHere = buildings.includes(THIS_BUILDING);

      // Add building if not already there
      if (!alreadyHere) {
        await User.findOneAndUpdate(
          { phone: cleanPhone },
          { $addToSet: { building: THIS_BUILDING }, $set: { isPhoneVerified: true, verified: true } }
        );
        buildings.push(THIS_BUILDING);
      }

      return res.status(200).json({
        success: true,
        isExisting: true,
        alreadyRegistered: alreadyHere,
        username: existingUser.username,
        buildings,
        user: { id: existingUser._id, phone: cleanPhone },
      });
    }

    // New user — OTP verified, signal frontend to collect name
    return res.status(200).json({
      success: true,
      isExisting: false,
      phone: cleanPhone,
    });

  } catch (error) {
    console.error("Verify OTP Error:", error.stack);
    return res.status(500).json({ success: false, message: "Verification failed. Please try again.", error: error.message });
  }
});

// REGISTER — only called for new users after name is collected
app.post("/register", async (req, res) => {
  try {
    const { username, phone } = req.body;
    if (!username || !phone) return res.status(400).json({ success: false, message: "Name and phone are required" });

    const cleanPhone = normalizePhone(phone);
    const THIS_BUILDING = "AVK Harsha";

    // Guard: don't double-create
    const existing = await User.findOne({ phone: cleanPhone });
    if (existing) {
      const buildings = Array.isArray(existing.building) ? existing.building : existing.building ? [existing.building] : [];
      if (!buildings.includes(THIS_BUILDING)) {
        await User.findOneAndUpdate({ phone: cleanPhone }, { $addToSet: { building: THIS_BUILDING } });
        buildings.push(THIS_BUILDING);
      }
      return res.status(200).json({ success: true, username: existing.username, buildings });
    }

    const user = await User.create({
      username: username.trim(),
      phone: cleanPhone,
      building: [THIS_BUILDING],
      isPhoneVerified: true,
      verified: true,
      role: "user",
    });

    return res.status(201).json({
      success: true,
      username: user.username,
      buildings: Array.isArray(user.building) ? user.building : [user.building],
      user: { id: user._id },
    });

  } catch (error) {
    console.error("Register Error:", error.stack);
    return res.status(500).json({ success: false, message: "Registration failed. Please try again.", error: error.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
