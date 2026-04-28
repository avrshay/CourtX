require("dotenv").config();
const path = require("path");
const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn(
    "GEMINI_API_KEY is not set. Add it to a .env file before analyzing frames."
  );
}

const FALLBACK_MODEL = "gemini-2.0-flash";
const envModel = (process.env.GEMINI_MODEL || "").trim();
const MODEL_NAME = envModel || FALLBACK_MODEL;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const appLogs = [];
const MAX_APP_LOGS = 200;

const SYSTEM_PROMPT = `ROLE: Expert Computer Vision Basketball Scout & API Logging Agent.
GOAL: Analyze the provided image frame (and any provided historical context) to identify visual player match-ups, outputting the results strictly in valid JSON format.
CONTEXT: You are the analysis engine for an automated real-time logging script. You receive frames every 5 seconds from a basketball broadcast. You must maintain consistency with previous frames (contextual continuity) to track players accurately, even if their jersey numbers become temporarily obscured.
METHOD:
Frame Validation: First, determine if the image shows active gameplay (a wide or tactical angle of the court). If it shows a close-up, the crowd, the coach, or a replay, abort analysis and return the "no_gameplay" status.
Contextual Tracking: Cross-reference current visual data (jersey numbers, player physique, position) with any previous context to ensure consistent player identification.
On-Ball Analysis: Identify the ball-carrier and their primary defender (the player squaring up and maintaining a close defensive stance).
Off-Ball Analysis: Identify other distinct 1-on-1 pairings on the court based on defensive proximity and body orientation.
Tactical Evaluation: Detect if a match-up is stable ("persistent"), if players swapped assignments ("switch"), or if there is an obvious physical discrepancy ("mismatch").
CONSTRAINTS:
Zero Audio/Graphics Reliance: Base all analysis strictly on player movement and positioning.
No Hallucinations: If a player's ID/number cannot be determined or inferred from context, use a visual descriptor (e.g., "Tall_White_Jersey").
Strict Output: Output ONLY raw, valid JSON. Do not include markdown formatting (like \`\`\`json), conversational text, or explanations outside the JSON structure.
OUTPUT: Output a single JSON object conforming exactly to this structure:
{
"timestamp": "[Insert relative timestamp of the clip]",
"status": "[active_gameplay OR no_gameplay]",
"ball_matchup": {
"offense_id": "[Number or Descriptor]",
"defense_id": "[Number or Descriptor]",
"action": "[e.g., Dribbling, Posting up, Holding]"
},
"off_ball_matchups": [
{"offense_id": "[ID]", "defense_id": "[ID]"},
{"offense_id": "[ID]", "defense_id": "[ID]"}
],
"tactical_event": "[None / Switch Detected / Mismatch Detected]",
"notes": "[Max 1 sentence of pure technical observation]"
}
CONSTRAINTS:`;

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

function addAppLog(level, message, meta = {}) {
  const entry = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    at: new Date().toISOString(),
    level,
    message,
    meta
  };

  appLogs.unshift(entry);
  if (appLogs.length > MAX_APP_LOGS) {
    appLogs.length = MAX_APP_LOGS;
  }

  const metaPart = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  const logger = level === "error" ? console.error : console.log;
  logger(`[APP:${level.toUpperCase()}] ${message}${metaPart}`);
}

function parseGeminiJson(text) {
  if (!text) {
    return null;
  }

  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = trimmed.slice(start, end + 1);
      return JSON.parse(candidate);
    }
    throw error;
  }
}

app.post("/api/analyze-frame", async (req, res) => {
  if (!genAI) {
    addAppLog("error", "Missing GEMINI_API_KEY");
    return res.status(500).json({
      error: "Gemini API key missing. Set GEMINI_API_KEY in .env."
    });
  }

  const { imageBase64, previousContext, timestamp } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== "string") {
    addAppLog("warn", "Invalid analyze-frame request payload");
    return res.status(400).json({ error: "imageBase64 is required." });
  }

  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const userPayload = {
      current_frame_timestamp: timestamp ?? "unknown",
      previous_context_json: previousContext ?? null
    };

    const result = await model.generateContent([
      {
        text: `${SYSTEM_PROMPT}\n\nFRAME CONTEXT JSON:\n${JSON.stringify(
          userPayload
        )}`
      },
      {
        inlineData: {
          data: imageBase64,
          mimeType: "image/jpeg"
        }
      }
    ]);

    const responseText = result.response.text();
    const parsed = parseGeminiJson(responseText);

    if (!parsed || typeof parsed !== "object") {
      addAppLog("error", "Gemini returned non-object JSON");
      return res.status(502).json({ error: "Invalid response from Gemini." });
    }

    addAppLog("info", "Frame analyzed", {
      timestamp: timestamp ?? "unknown",
      status: parsed.status ?? "unknown"
    });
    return res.json({ data: parsed, raw: responseText });
  } catch (error) {
    const status = error?.status ?? 500;
    const details = error?.message || "Unknown error";
    const retryInfo = Array.isArray(error?.errorDetails)
      ? error.errorDetails.find((item) => item?.["@type"]?.includes("RetryInfo"))
      : null;
    const retryAfter = retryInfo?.retryDelay || null;

    const invalidModel =
      status === 404 &&
      typeof details === "string" &&
      details.includes("is not found");

    if (invalidModel) {
      addAppLog("error", "Invalid Gemini model configured", {
        configuredModel: MODEL_NAME,
        fallbackModel: FALLBACK_MODEL
      });
    }

    addAppLog("error", "Gemini analyze-frame error", {
      status,
      retryAfter,
      details
    });

    const quotaExhausted =
      status === 429 &&
      typeof details === "string" &&
      details.toLowerCase().includes("limit: 0");
    const statusCode = status === 429 ? 429 : 500;
    const errorMessage = invalidModel
      ? `Configured model "${MODEL_NAME}" is invalid for this API. Set GEMINI_MODEL=${FALLBACK_MODEL} in .env and restart the server.`
      : quotaExhausted
      ? "Gemini quota exhausted for this API key/project (limit: 0). Enable billing or use a key/project with available quota."
      : "Failed to analyze frame.";

    return res.status(statusCode).json({
      error: errorMessage,
      details,
      status,
      retryAfter,
      quotaExhausted
    });
  }
});

app.get("/api/app-logs", (_req, res) => {
  return res.json({ logs: appLogs });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  addAppLog("info", `Server running on http://localhost:${PORT}`, {
    model: MODEL_NAME
  });
});
