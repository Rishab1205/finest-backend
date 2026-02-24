import express from "express";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";   // ✅ THIS LINE IS REQUIRED

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ⭐ CUSTOM CORS HEADERS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/", (req, res) => {
  res.send("✅ Finest backend is running");
});

// --------------------------------------------
//  PAID USERS CACHE (FOR BOT)
// --------------------------------------------
const paidUsers = {};
const freeUsers = {};

// --------------------------------------------
//  DISCORD WEBHOOK SENDER
// --------------------------------------------
async function sendWebhook(url, payload) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    console.log("WEBHOOK SENT:", res.status);
  } catch (err) {
    console.log("WEBHOOK ERROR:", err.message);
  }
}

// --------------------------------------------
//   GMAIL SMTP
// --------------------------------------------
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASS,
  },
});

// --------------------------------------------
//  FINALIZE PAYMENT (SUPABASE PERMANENT)
// --------------------------------------------
app.post("/finalize", async (req, res) => {
  try {
    const {
      name,
      email,
      discord_name,
      discord_id,
      product,
      amount,
      payment_id
    } = req.body;

    if (!name || !email || !discord_name || !discord_id || !product || !payment_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 🔥 INSERT INTO SUPABASE (PERMANENT STORAGE)
    const { error } = await supabase
      .from("payments")
      .insert([
        {
          name,
          email,
          discord_name,
          discord_id: String(discord_id),
          product,
          amount: Number(amount || 0),
          payment_id,
          status: "paid",
          claimed: false
        }
    ]);

    
    // --------------------------
    // DISCORD WEBHOOK (UNCHANGED)
    // --------------------------
    await sendWebhook(process.env.WEBHOOK_PAID, {
      embeds: [{
        title: "🧾 New Manual Payment Submitted",
        color: 0xffc107,
        fields: [
          { name: "Name", value: name, inline: true },
          { name: "Email", value: email, inline: true },
          { name: "Discord", value: discord_name, inline: true },
          { name: "Discord ID", value: discord_id },
          { name: "Product", value: product, inline: true },
          { name: "Amount", value: "₹" + amount, inline: true },
          { name: "Transaction ID", value: payment_id }
        ],
        timestamp: new Date().toISOString()
      }]
    });

    return res.json({ success: true });

  } catch (err) {
    console.log("Finalize Error:", err);
    return res.status(500).json({ error: "finalize_failed" });
  }
});

// --------------------------------------------
//  BOT PAYMENT CHECK (SUPABASE VERSION)
// --------------------------------------------
app.get("/check-payment/:discordId", async (req, res) => {
  try {
    const id = req.params.discordId;

    // 🔍 Check Supabase first (PAID)
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("discord_id", id)
      .eq("claimed", false)
      .limit(1);

    if (error) {
      console.log("Supabase Fetch Error:", error.message);
      return res.json({ paid: false });
    }

    if (data && data.length > 0) {
      const record = data[0];

      return res.json({
        paid: true,
        type: "PAID",
        data: {
          product: record.product,
          amount: record.amount,
          payment_id: record.payment_id,
          status: "paid"
        }
      });
    }

    // 🔍 Check FREE cache
    if (freeUsers[id]) {
      return res.json({
        paid: true,
        type: "FREE",
        data: {
          product: "FREE PACK",
          status: "FREE"
        }
      });
    }

    return res.json({ paid: false });

  } catch (err) {
    console.log("Check Payment Error:", err);
    return res.json({ paid: false });
  }
});

// --------------------------------------------
//  FREE PACK SUBMIT (UNCHANGED)
// --------------------------------------------

app.post("/freepack", async (req, res) => {
  try {
    const { name, email, discord, discordId, discord_id: raw_id } = req.body;
    const discord_id = discordId || raw_id;

    if (!name || !email || !discord || !discord_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 🔐 FIX 3B — Discord ID sanity check (backend)
    if (!/^\d{17,19}$/.test(discord_id)) {
        return res.status(400).json({
            error: "Invalid Discord ID format"
        });
    }  
    
    // ⭐ FIX 1 — STORE FREE PACK USER
    freeUsers[discord_id] = {
      name,
      email,
      discord,
      discord_id,
      product: "FREE PACK",
      status: "FREE",
      createdAt: Date.now()
    };

    setTimeout(() => {
      delete freeUsers[discord_id];
    }, 1000 * 60 * 60);

    if (process.env.WEBHOOK_FREE) {
      await sendWebhook(process.env.WEBHOOK_FREE, {
        embeds: [
          {
            title: "🎁 Free Pack Claimed",
            color: 0x5865f2,
            fields: [
              { name: "Name", value: name },
              { name: "Email", value: email },
              { name: "Discord", value: discord },
              { name: "Discord ID", value: discord_id }
            ],
            timestamp: new Date().toISOString()
          }
        ]
      });
    }

    return res.json({ success: true });

  } catch (err) {
    console.log("FreePack Error:", err);
    res.status(500).send({ error: "freepack_failed" });
  }
});

// --------------------------------------------
//  START SERVER
// --------------------------------------------

const PORT = process.env.PORT;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});













