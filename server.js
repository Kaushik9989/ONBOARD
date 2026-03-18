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



// VERIFY OTP + REGISTER
app.post("/verify-otp-and-register", async (req, res) => {
  try {
    const { username, phone, otp } = req.body;
    if (!username || !phone || !otp) {
      return res.status(400).json({ success: false, message: "Name, phone, and OTP are all required" });
    }  

    const cleanPhone = normalizePhone(phone);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: "Invalid phone number format" });
    }

    // Verify OTP first
    const verificationCheck = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: `+91${cleanPhone}`, code: otp });

    if (verificationCheck.status !== "approved") {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP. Please try again." });
    }

    const THIS_BUILDING = "AVK Harsha";
    const existingUser = await User.findOne({ phone: cleanPhone });

    if (existingUser) {
      // building is an array — safely coerce old string values too
      const buildings = Array.isArray(existingUser.building)
        ? existingUser.building
        : existingUser.building
          ? [existingUser.building]
          : [];

      if (buildings.includes(THIS_BUILDING)) {
        // Already at this building — return full list
        return res.status(200).json({
          success: false,
          alreadyRegistered: true,
          message: "You are already registered at Harsha AVK.",
          buildings: buildings,
        });
      }

      // Exists but not at this building — add it
      const updatedUser = await User.findOneAndUpdate(
        { phone: cleanPhone },
        {
          $set: { username: username.trim(), isPhoneVerified: true, verified: true },
          $addToSet: { building: THIS_BUILDING },
        },
        { new: true }
      );

      const updatedBuildings = Array.isArray(updatedUser.building)
        ? updatedUser.building
        : updatedUser.building ? [updatedUser.building] : [];

      return res.status(200).json({
        success: true,
        message: "Building added to your account.",
        buildings: updatedBuildings,
        user: { id: updatedUser._id, username: updatedUser.username, phone: updatedUser.phone },
      });
    }

    // Brand new user
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
      message: "User registered successfully",
      buildings: Array.isArray(user.building) ? user.building : [user.building],
      user: { id: user._id, username: user.username, phone: user.phone },
    });

  } catch (error) {
    console.error("Verify/Register Error:", error.stack);
    return res.status(500).json({ success: false, message: "Registration failed. Please try again.", error: error.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
