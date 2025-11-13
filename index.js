// server/index.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { prepareGoogleCreds } from "./credentials.js";
import { GoogleAuth } from "google-auth-library";

const app = express();
app.use(express.json({ limit: "2mb" }));

// CORS
app.use(cors({ origin: "*" }));

const PORT = process.env.PORT || 3000;

// Create creds if needed
prepareGoogleCreds();

// ------------- RETRY LOGIC -------------
async function fetchWithRetry(url, options, retries = 7) {
  let delay = 600;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);

      // If Gemini overloaded → retry
      if ([429, 500, 502, 503, 504].includes(res.status)) {
        console.log(
          `⚠️ Gemini error ${res.status} — retry ${attempt}/${retries}...`
        );

        if (attempt === retries) return res; // last attempt → return as-is

        await new Promise((r) => setTimeout(r, delay));
        delay *= 1.8;
        continue;
      }

      return res; // success
    } catch (err) {
      console.log(`⚠️ Network error on attempt ${attempt}:`, err);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 1.8;
    }
  }
}

// ----------- PRIMARY & FALLBACK MODELS ------------
const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-mini"; // very stable fallback

// Gemini endpoint builder
function modelEndpoint(modelName) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
}

// ----------- HEALTH -----------
app.get("/health", (req, res) => res.json({ ok: true }));

// ----------- MAIN GENERATE ENDPOINT -----------
app.post("/api/generate", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const modelsToTry = [PRIMARY_MODEL, FALLBACK_MODEL];

    for (let modelName of modelsToTry) {
      console.log(`➡️ Trying model: ${modelName}`);

      let url = modelEndpoint(modelName);
      const headers = { "Content-Type": "application/json" };

      // API Key mode
      if (process.env.GOOGLE_API_KEY) {
        url += `?key=${process.env.GOOGLE_API_KEY}`;
      } else {
        // Service account fallback
        const auth = new GoogleAuth({
          scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });
        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();
        headers["Authorization"] = `Bearer ${accessToken.token || accessToken}`;
      }

      const body = {
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      };

      const gresp = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
        7
      );

      if (!gresp.ok) {
        console.log(
          `❌ Model ${modelName} failed with status ${gresp.status}`
        );

        // if last model, return error
        if (modelName === FALLBACK_MODEL) {
          const text = await gresp.text().catch(() => "");
          return res.status(502).json({
            error: "upstream error",
            status: gresp.status,
            body: text,
          });
        }

        // otherwise try next model
        continue;
      }

      // Successful → extract response
      const json = await gresp.json();

      let extracted = null;
      try {
        const parts =
          json?.candidates?.[0]?.content?.parts ||
          json?.content?.[0]?.parts ||
          [];
        extracted = parts.map((p) => p.text || "").join("\n");
      } catch (e) {}

      return res.json({ raw: json, text: extracted });
    }
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "internal error", details: err.toString() });
  }
});

app.listen(PORT, () =>
  console.log(`🚀 Backend running on port ${PORT}`)
);
