import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
import express from "express";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import cors from "cors";

dotenv.config();

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
//  FINALIZE PAYMENT (MANUAL / QR / UPI)
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

    // ⭐ STORE FOR BOT ACCESS
    paidUsers[discord_id] = {
      name,
      email,
      discord_name,
      discord_id,
      product,
      amount,
      payment_id,
      status: "PAID",
      createdAt: Date.now()
    };

    setTimeout(() => {
      delete paidUsers[discord_id];
    }, 1000 * 60 * 60); // auto delete after 1 hour
    
    // DISCORD WEBHOOK
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

    // EMAIL CONFIRMATION
    try {
      await mailer.sendMail({
        to: email,
        subject: `Payment Submitted | ${product}`,
        html: `
          <div style="font-family: Arial; padding:20px;">
            <h2>🧾 Payment Received</h2>
            <p>Hi <b>${name}</b>,</p>
            <p>Your payment details have been submitted successfully.</p>
            <ul>
              <li>Product: <b>${product}</b></li>
              <li>Transaction ID: <b>${payment_id}</b></li>
              <li>Status: <b>Under Verification</b></li>
            </ul>
            <p>Our team will contact you on Discord shortly.</p>
            <p>— Finest Store</p>
          </div>
        `
      });
    } catch (err) {
      console.log("Email error (ignored):", err.message);
    }

    return res.json({ success: true });

  } catch (err) {
    console.log("Finalize Error:", err);
    return res.status(500).json({ error: "finalize_failed" });
  }
});

// --------------------------------------------
//  BOT PAYMENT CHECK (READ-ONLY)
// --------------------------------------------

app.get("/check-payment/:discordId", (req, res) => {
  const id = req.params.discordId;

  // ✅ PAID USER
  if (paidUsers[id]) {
    const record = paidUsers[id];
    return res.json({
      paid: true,
      type: "PAID",
      data: {
        product: record.product,
        amount: record.amount,
        payment_id: record.payment_id,
        status: record.status
      }
    });
  }

  // ✅ FREE USER
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

  // ❌ NOT FOUND
  return res.json({ paid: false });
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






