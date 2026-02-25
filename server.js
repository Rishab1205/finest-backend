import express from "express";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";   // ✅ THIS LINE IS REQUIRED
import fetch from "node-fetch";
import FormData from "form-data";

dotenv.config();

import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage()
});

// ================================
// 🆔 ORDER ID GENERATOR
// ================================

function generateOrderId() {
  const random = Math.floor(1000 + Math.random() * 9000);
  const timestamp = Date.now().toString().slice(-5);
  return `FS-${timestamp}-${random}`;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PACK_SERVICES_WEBHOOK = process.env.WEBHOOK_PACK;
const OTHER_SERVICES_WEBHOOK = process.env.WEBHOOK_OTHER_SERVICES;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const LOGO_URL = process.env.LOGO_URL;

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
//  FILE WEBHOOK SENDER (FOR SCREENSHOTS ONLY)
// --------------------------------------------
async function sendWebhookWithFile(url, embedPayload, fileBuffer, fileName) {
  const form = new FormData();

  form.append("payload_json", JSON.stringify(embedPayload));
  form.append("file", fileBuffer, fileName);

  const res = await fetch(url, {
    method: "POST",
    body: form
  });

  console.log("SCREENSHOT WEBHOOK STATUS:", res.status);
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

      if (error.message.includes("duplicate key")) {
        return res.status(400).json({
          error: "duplicate_payment",
          message: "This payment ID has already been used."
        });
      }
      
      return res.status(500).json({ error: "database_error" });
    }


    // 🔥 Decide which webhook
    const webhookURL =
      product === "Other Services"
        ? OTHER_SERVICES_WEBHOOK
        : PACK_SERVICES_WEBHOOK;

    // --------------------------
    // 🎨 PREMIUM ORDER WEBHOOK
    // --------------------------
    await sendWebhook(webhookURL, {
      username: "Finest Order System",
      avatar_url: LOGO_URL,
      content: STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : null,
      embeds: [
        {
          title: "✨ New Order Received",
          color: 0xD4AF37,
          thumbnail: { url: LOGO_URL },
          fields: [
            { name: "🆔 Order ID", value: `\`${orderId}\``, inline: true },
            { name: "👤 Customer", value: `**${name}**`, inline: true },
            { name: "📦 Product", value: `\`${product}\``, inline: true },
            { name: "💰 Amount", value: `₹${amount}`, inline: true },
            { name: "🧾 Payment ID", value: `\`${payment_id}\`` },
            {
              name: "🎮 Discord Info",
              value: `${discord_name}\nID: \`${discord_id}\``
            }
          ],
          footer: {
            text: "Finest Store • Automated Order System",
            icon_url: LOGO_URL
          },
          timestamp: new Date().toISOString()
        }
      ]
    });

    // --------------------------
    // 🔔 SECOND WEBHOOK (PREMIUM VERSION)
    // --------------------------
    await sendWebhook(process.env.WEBHOOK_PAID, {
      username: "Finest Store • Orders",
      avatar_url: LOGO_URL,
      content: STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : null,
      embeds: [
        {
          title: "💳 New Premium Order Received",
          description:
            `A verified payment has been submitted.\n\n` +
            `🆔 **Order ID:** \`${orderId}\``,
          color: 0x2B2D31,
          thumbnail: { url: LOGO_URL },
          fields: [
            {
              name: "👤 Customer Info",
              value:
                `**Name:** ${name}\n` +
                `**Email:** ${email}\n` +
                `**Discord:** ${discord_name}\n` +
                `**Discord ID:** ${discord_id}`
            },
            {
              name: "📦 Order Details",
              value:
                `**Product:** ${product}\n` +
                `**Amount:** ₹${amount}\n` +
                `**Payment ID:** ${payment_id}`
            }
          ],
          footer: {
            text: "Finest Store • Secure Payment System",
            icon_url: LOGO_URL
          },
          timestamp: new Date().toISOString()
        }
      ]
    });

    return res.json({ success: true });

  } catch (err) {
    console.error("Finalize Error:", err);
    return res.status(500).json({ error: "finalize_failed" });
  }
});

// --------------------------------------------
//  SERVICE REQUEST (OTHER SERVICES)
// --------------------------------------------
app.post("/service-request", async (req, res) => {
  try {
    const { username, service_type, plan, requirements } = req.body;

    if (!username || !service_type || !plan || !requirements) {
      return res.status(400).json({ success: false, error: "missing_fields" });
    }

    const orderId = `FS-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;

    await sendWebhook(OTHER_SERVICES_WEBHOOK, {
      username: "Finest Store • Service Desk",
      avatar_url: LOGO_URL,
      content: STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : null,
      embeds: [
        {
          title: "📩 New Service Request",
          description:
            `A new **Other Services** request has been submitted.\n\n` +
            `🆔 **Order ID:** \`${orderId}\``,
          color: 0x5865F2,
          thumbnail: { url: LOGO_URL },
          fields: [
            { name: "User", value: `\`${username}\``, inline: true },
            { name: "Service", value: `\`${service_type}\``, inline: true },
            { name: "Package / Price", value: `\`${plan}\`` },
            { name: "Requirements", value: requirements.slice(0, 1000) }
          ],
          footer: {
            text: "Finest Store • Staff will contact on Discord",
            icon_url: LOGO_URL
          },
          timestamp: new Date().toISOString()
        }
      ]
    });

    return res.json({ success: true, order_id: orderId });

  } catch (err) {
    console.error("service-request error:", err);
    return res.status(500).json({ success: false, error: "service_request_failed" });
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

// =============================
//  CLEAN FREEPACK SYSTEM (V2)
//  Add-only. Keeps old logic.
// =============================

// ✅ NEW: Register FreePack to Supabase + Premium webhook
app.post("/free-register-v2", async (req, res) => {
  try {
    const { name, email, discord_username, discord_id } = req.body;

    if (!name || !email || !discord_id) {
      return res.status(400).json({ success: false, error: "missing_fields" });
    }

    // Discord ID validation
    if (!/^\d{17,19}$/.test(String(discord_id))) {
      return res.status(400).json({ success: false, error: "invalid_discord_id" });
    }

    const orderId = `FREE-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Insert into Supabase (permanent)
    const { error } = await supabase
      .from("user_access")
      .insert([{
        name,
        email,
        discord_username: discord_username || "",
        discord_id: String(discord_id),
        type: "FREE",
        product: "FREE PACK",
        claimed: false,
        order_id: orderId
      }]);

    if (error) {
      // If you added any unique constraint later, treat duplicates nicely
      if (String(error.message || "").toLowerCase().includes("duplicate")) {
        return res.json({ success: true, order_id: orderId, note: "already_registered" });
      }
      console.error("❌ Free-register-v2 Supabase error:", error.message);
      return res.status(500).json({ success: false, error: "database_error" });
    }

    // Premium webhook log (free-log channel)
    if (process.env.WEBHOOK_FREE_PREMIUM) {
      await sendWebhook(process.env.WEBHOOK_FREE_PREMIUM, {
        username: "Finest Store • FreePack",
        avatar_url: process.env.LOGO_URL,
        content: process.env.STAFF_ROLE_ID ? `<@&${process.env.STAFF_ROLE_ID}>` : undefined,
        embeds: [{
          title: "🎁 New FreePack Registration",
          description: "A user registered for the FreePack.",
          color: 0x5865F2,
          thumbnail: { url: process.env.LOGO_URL },
          fields: [
            { name: "🆔 Order ID", value: `\`${orderId}\``, inline: true },
            { name: "👤 Name", value: `**${name}**`, inline: true },
            { name: "📧 Email", value: email, inline: false },
            { name: "🎮 Discord", value: discord_username || "N/A", inline: true },
            { name: "🔢 Discord ID", value: `\`${discord_id}\``, inline: true },
            { name: "📦 Product", value: "`FREE PACK`", inline: true }
          ],
          footer: { text: "Finest Store • Free Access System" },
          timestamp: new Date().toISOString()
        }]
      });
    }

    return res.json({ success: true, order_id: orderId });

  } catch (err) {
    console.error("❌ free-register-v2 error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});


// ✅ NEW: Bot checks Supabase for FREE/PAID access
app.get("/check-user-v2/:discordId", async (req, res) => {
  try {
    const id = String(req.params.discordId || "").trim();

    if (!/^\d{17,19}$/.test(id)) {
      return res.json({ exists: false });
    }

    const { data, error } = await supabase
      .from("user_access")
      .select("type, product, claimed, order_id")
      .eq("discord_id", id)
      .eq("claimed", false)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("❌ check-user-v2 Supabase error:", error.message);
      return res.json({ exists: false });
    }

    if (!data || data.length === 0) return res.json({ exists: false });

    const record = data[0];
    return res.json({
      exists: true,
      type: record.type,           // "FREE" or "PAID"
      product: record.product,
      order_id: record.order_id
    });

  } catch (err) {
    console.error("❌ check-user-v2 error:", err);
    return res.json({ exists: false });
  }
});


// ✅ OPTIONAL: mark FREE claim after role assigned (call from bot later if you want)
app.post("/mark-claimed-v2", async (req, res) => {
  try {
    const { discord_id } = req.body;
    if (!discord_id) return res.status(400).json({ success: false });

    await supabase
      .from("user_access")
      .update({ claimed: true })
      .eq("discord_id", String(discord_id))
      .eq("claimed", false);

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ mark-claimed-v2 error:", err);
    return res.status(500).json({ success: false });
  }
});

// --------------------------------------------
//  START SERVER
// --------------------------------------------

const PORT = process.env.PORT;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});

// --------------------------------------------
//  SCREENSHOT UPLOAD (SEPARATE PREMIUM WEBHOOK)
// --------------------------------------------
app.post("/upload-screenshot", upload.single("screenshot"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const customerName = req.body.customer_name || "Unknown Customer";

    const screenshotBuffer = req.file.buffer;
    const screenshotBase64 = screenshotBuffer.toString("base64");
    
    await sendWebhookWithFile(
      process.env.WEBHOOK_SCREENSHOT,
      {
        username: "Finest Payment System",
        avatar_url: LOGO_URL,
        embeds: [
          {
            title: "🧾 Payment Screenshot Submitted",
            description: `👤 **Customer:** ${customerName}`,
            color: 0x2B2D31,
            image: {
              url: "attachment://screenshot.png"
            },
            footer: {
              text: "Finest Store • Payment Verification",
              icon_url: LOGO_URL
            },
            timestamp: new Date().toISOString()
          }
        ]
      },
      req.file.buffer,
      "screenshot.png"
    );

    console.log("📸 Screenshot sent to premium channel");

    return res.json({ success: true });

  } catch (err) {
    console.error("Screenshot upload error:", err);
    return res.status(500).json({ error: "screenshot_failed" });
  }
});

