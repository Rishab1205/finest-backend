import express from "express";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";   // ✅ THIS LINE IS REQUIRED

dotenv.config();

// ================================
// 🆔 ORDER ID GENERATOR
// ================================

function generateOrderId() {
  const random = Math.floor(1000 + Math.random() * 9000);
  const timestamp = Date.now().toString().slice(-5);
  return `FS-${timestamp}-${random}`;
}

// Your logo (host it somewhere public OR Discord CDN link)
const LOGO_URL =
  "https://cdn.discordapp.com/attachments/1138724463601537116/1476141309210267678/original-61ead0961d83ee5faab5cfc4ec87076c.png?ex=69a00b39&is=699eb9b9&hm=433f819aaf2c973e78e9fc90d6d8eaf0484a384acd4d88ec4b669f00bb2c1351&";

// Staff role ID (NOT name — ID)
const STAFF_ROLE_ID = "1464249885669851360";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PACK_SERVICES_WEBHOOK = process.env.WEBHOOK_PACK;
const OTHER_SERVICES_WEBHOOK = process.env.WEBHOOK_OTHER;

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
//  FINALIZE PAYMENT (FULL PRODUCTION VERSION)
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

    // 🆔 Generate Order ID
    const orderId = `FS-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    // 🔥 Save to Supabase
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
          claimed: false,
          order_id: orderId
        }
      ]);

    if (error) {
      console.error("Supabase Error:", error.message);
      return res.status(500).json({ error: "database_error" });
    }

    // 🔥 Decide which main webhook to send
    const webhookURL =
      product === "Other Services"
        ? OTHER_SERVICES_WEBHOOK
        : PACK_SERVICES_WEBHOOK;

    const embedColor =
      product === "Other Services"
        ? 0x2B2D31
        : 0xD4AF37;

    // --------------------------
    // 🎨 PREMIUM ORDER WEBHOOK
    // --------------------------
    await sendWebhook(webhookURL, {
      username: "Finest Order System",
      avatar_url: "https://cdn.discordapp.com/attachments/1138724463601537116/1476141309210267678/original-61ead0961d83ee5faab5cfc4ec87076c.png?ex=69a00b39&is=699eb9b9&hm=433f819aaf2c973e78e9fc90d6d8eaf0484a384acd4d88ec4b669f00bb2c1351&", // 🔥 replace with real logo link
      content: `<@&${STAFF_ROLE_ID}>`, // 🔥 replace with real staff role ID
      embeds: [
        {
          title: "✨ New Order Received",
          color: 0x2B2D31,
          thumbnail: {
            url: LOGO_URL
          },
          fields: [
            {
              name: "🆔 Order ID",
              value: `\`${orderId}\``,
              inline: true
            },
            {
              name: "👤 Customer",
              value: `**${name}**`,
              inline: true
            },
            {
              name: "📦 Product",
              value: `\`${product}\``,
              inline: true
            },
            {
              name: "💰 Amount",
              value: `₹${amount}`,
              inline: true
            },
            {
              name: "🧾 Payment ID",
              value: `\`${payment_id}\``,
              inline: false
            },
            {
              name: "🎮 Discord Info",
              value: `${discord_name}\nID: \`${discord_id}\``,
              inline: false
            }
          ],
          footer: {
            text: "Finest Store • Automated Order System"
          },
          timestamp: new Date().toISOString()
        }
      ]
    });

    // --------------------------
    // 🔔 SECOND WEBHOOK (UNCHANGED)
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
          { name: "Transaction ID", value: payment_id },
          { name: "Order ID", value: orderId }
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

















