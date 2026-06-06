import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./models/user.js";
import Tweet from "./models/tweet.js";
import useragent from "useragent";
import requestIp from "request-ip";
import LoginHistory from "./models/LoginHistory.js";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Store OTPs temporarily in memory
const otpStore = {};

function getDeviceCategory(ua) {
  const device = ua.device.family.toLowerCase();
  const os = ua.os.family.toLowerCase();
  if (device.includes('iphone') || device.includes('android') || 
      device.includes('mobile') || os.includes('android') || os.includes('ios')) return 'mobile';
  return 'desktop';
}

// Email transporter - UPDATE with your Gmail credentials in .env
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.get("/", (req, res) => {
  res.send("Twiller backend is running successfully");
});

// ✅ Send OTP endpoint
app.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[email] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 }; // 5 min expiry

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your Twiller Login OTP',
      html: `<h2>Your OTP is: <strong>${otp}</strong></h2><p>Valid for 5 minutes.</p>`,
    });

    res.json({ success: true, message: 'OTP sent to email' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Verify OTP endpoint
app.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const stored = otpStore[email];

    if (!stored) return res.status(400).json({ error: 'No OTP found. Please request again.' });
    if (Date.now() > stored.expiresAt) return res.status(400).json({ error: 'OTP expired. Please request again.' });
    if (stored.otp !== otp) return res.status(400).json({ error: 'Invalid OTP.' });

    // OTP valid - delete it and return user
    delete otpStore[email];
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Save login history
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get logged in user by email - WITH SECURITY RULES
app.get("/loggedinuser", async (req, res) => {
  try {
    const { email } = req.query;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const agent = useragent.parse(req.headers['user-agent']);
    const ip = requestIp.getClientIp(req);
    const deviceCategory = getDeviceCategory(agent);
    const browserName = agent.family;

    const loginData = {
      browser: browserName,
      os: agent.os.toString(),
      deviceCategory,
      ipAddress: ip,
      userId: user._id
    };

    // RULE 1: Chrome needs OTP first
    if (browserName === 'Chrome') {
      return res.json({ requireOTP: true, email, user, loginData });
    }

    // RULE 2: Mobile only 10AM-1PM
    if (deviceCategory === 'mobile') {
      const hour = new Date().getHours();
      if (hour < 10 || hour >= 13) {
        return res.status(403).json({
          error: 'Mobile login allowed only between 10:00 AM and 1:00 PM'
        });
      }
    }

    // RULE 3: Edge/others = direct login - save history
    await LoginHistory.create(loginData);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Register new user
app.post("/register", async (req, res) => {
  try {
    const { username, displayName, avatar, email } = req.body;
    let user = await User.findOne({ email });
    if (user) return res.json(user);
    user = await User.create({
      username, displayName, avatar, email, joinedDate: new Date(),
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Update user profile
app.patch("/userupdate/:email", async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { email: req.params.email }, req.body, { new: true }
    );
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get all posts/tweets
app.get("/post", async (req, res) => {
  try {
    const tweets = await Tweet.find().populate("author").sort({ createdAt: -1 });
    res.json(tweets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Create a new post/tweet
app.post("/post", async (req, res) => {
  try {
    const tweet = await Tweet.create(req.body);
    const populated = await tweet.populate("author");
    res.json(populated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Like a tweet
app.post("/like/:tweetId", async (req, res) => {
  try {
    const { userId } = req.body;
    const tweet = await Tweet.findById(req.params.tweetId);
    if (!tweet) return res.status(404).json({ message: "Tweet not found" });
    const alreadyLiked = tweet.likedBy?.includes(userId);
    if (alreadyLiked) {
      tweet.likedBy = tweet.likedBy.filter((id) => id.toString() !== userId);
      tweet.likes = Math.max(0, (tweet.likes || 0) - 1);
    } else {
      tweet.likedBy = [...(tweet.likedBy || []), userId];
      tweet.likes = (tweet.likes || 0) + 1;
    }
    await tweet.save();
    const populated = await tweet.populate("author");
    res.json(populated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Retweet a tweet
app.post("/retweet/:tweetId", async (req, res) => {
  try {
    const { userId } = req.body;
    const tweet = await Tweet.findById(req.params.tweetId);
    if (!tweet) return res.status(404).json({ message: "Tweet not found" });
    const alreadyRetweeted = tweet.retweetedBy?.includes(userId);
    if (alreadyRetweeted) {
      tweet.retweetedBy = tweet.retweetedBy.filter((id) => id.toString() !== userId);
      tweet.retweets = Math.max(0, (tweet.retweets || 0) - 1);
    } else {
      tweet.retweetedBy = [...(tweet.retweetedBy || []), userId];
      tweet.retweets = (tweet.retweets || 0) + 1;
    }
    await tweet.save();
    const populated = await tweet.populate("author");
    res.json(populated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get login history for a user
app.get("/loginhistory/:userId", async (req, res) => {
  try {
    const history = await LoginHistory.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT || 5000;
const url = process.env.MONOGDB_URL;

mongoose.connect(url)
  .then(() => {
    console.log("✅ Connected to MongoDB");
    app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
  })
  .catch((err) => console.error("MongoDB connection error:", err));