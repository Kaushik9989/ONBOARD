const express = require("express");
require("dotenv").config();
const User = require("./models/user");
const twilio = require("twilio");
const app = express();
const path = require("path");
const mongoose = require("mongoose");
const LocationPartner = require("./models/LocationPartnerSchema")
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
    const { phone, otp, partnerId } = req.body;

    if (!phone || !otp || !partnerId) {
      return res.status(400).json({ success: false, message: "Phone, OTP and partnerId are required" });
    }

    const cleanPhone = normalizePhone(phone);

    const partner = await LocationPartner.findById(partnerId);
    if (!partner) {
      return res.status(400).json({ success: false, message: "Invalid partner" });
    }

    const verificationCheck = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: `+91${cleanPhone}`, code: otp });

    if (verificationCheck.status !== "approved") {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    const existingUser = await User.findOne({ phone: cleanPhone });

    if (existingUser) {
     const alreadyLinked = existingUser.locationPartners.some(
  id => id.toString() === partner._id.toString()
);

      if (!alreadyLinked) {
        await User.findByIdAndUpdate(existingUser._id, {
          $addToSet: { locationPartners: partner._id },
          $set: { isPhoneVerified: true, verified: true }
        });
      }

const updatedUser = await User.findById(existingUser._id)
  .populate("locationPartners", "partnerName");

const allPartners = updatedUser.locationPartners.map(p => p.partnerName);

return res.json({
  success: true,
  isExisting: true,
  username: updatedUser.username,
  partners: allPartners,
  user: { id: updatedUser._id }
});
    }

    return res.json({
      success: true,
      isExisting: false,
      phone: cleanPhone
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Verification failed" });
  }
});
// REGISTER — only called for new users after name is collected

app.post("/register", async (req, res) => {
  try {
    const { username, phone, partnerId } = req.body;

    if (!username || !phone || !partnerId) {
      return res.status(400).json({ success: false, message: "All fields required" });
    }

    const cleanPhone = normalizePhone(phone);

    const partner = await LocationPartner.findById(partnerId);
    if (!partner) {
      return res.status(400).json({ success: false, message: "Invalid partner" });
    }

    const existing = await User.findOne({ phone: cleanPhone });

    if (existing) {
      await User.findByIdAndUpdate(existing._id, {
        $addToSet: { locationPartners: partner._id }
      });

const updatedUser = await User.findById(existing._id)
  .populate("locationPartners", "partnerName");

const allPartners = updatedUser.locationPartners.map(p => p.partnerName);

return res.json({
  success: true,
  username: updatedUser.username,
  partners: allPartners
});
    }

    const user = await User.create({
      username: username.trim(),
      phone: cleanPhone,
      locationPartners: [partner._id],
      isPhoneVerified: true,
      verified: true,
      role: "user"
    });

    return res.status(201).json({
      success: true,
      username: user.username,
      partners: [partner.partnerName],
      user: { id: user._id }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});
app.get("/:slug", async (req, res) => {
  const { slug } = req.params;

  const partner = await LocationPartner.findOne({ slug });

  if (!partner) return res.status(404).send("Invalid onboarding link");

  res.render("onboard", { partner });
});
app.listen(3000, () => console.log("Server running on port 3000"));
