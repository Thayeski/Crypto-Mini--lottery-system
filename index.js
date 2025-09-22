import express from "express";
import { Telegraf, Markup } from "telegraf";
import mongoose from "mongoose";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(express.json());

// ===== MongoDB Connect =====
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Error:", err));

// ===== User Schema =====
const userSchema = new mongoose.Schema({
  telegramId: String,
  spinsLeft: { type: Number, default: 3 },
  rewards: [String],
  balance: { type: Number, default: 0 },
  lastSpinDate: { type: Date, default: null }
});
const User = mongoose.model("User", userSchema);

// ===== Telegram Bot =====
const bot = new Telegraf(process.env.BOT_TOKEN);

// /start command
bot.start(async (ctx) => {
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
});

// /balance command
bot.command("balance", async (ctx) => {
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

bot.launch();

// ===== Telegram Verification =====
function verifyTelegram(initData) {
  const parsed = new URLSearchParams(initData);
  const hash = parsed.get("hash");
  parsed.delete("hash");

  const dataCheckString = [...parsed.entries()]
    .map(([key, val]) => `${key}=${val}`)
    .sort()
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData")
    .update(process.env.BOT_TOKEN)
    .digest();

  const hmac = crypto.createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return hmac === hash;
}

// ===== Spin API =====
app.post("/api/spin", async (req, res) => {
  const { initData } = req.body;

  if (!verifyTelegram(initData)) {
    return res.status(403).json({ error: "Invalid Telegram data" });
  }

  const parsed = new URLSearchParams(initData);
  const telegramId = parsed.get("user");

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
    return res.json({ error: "No spins left today" });
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

  res.json({ reward: reward.label, balance: user.balance, spinsLeft: user.spinsLeft });
});

// ===== Automatic Daily Reset (Midnight UTC) =====
setInterval(async () => {
  await User.updateMany({}, { spinsLeft: 3, lastSpinDate: new Date() });
  console.log("🔄 Spins reset for all users at midnight UTC");
}, 24 * 60 * 60 * 1000);

// ===== Start Server =====
app.listen(5000, () => console.log("🚀 Backend running on port 5000"));
