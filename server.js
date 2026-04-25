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

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

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
    return res.status(500).json({
      error: "Gemini API key missing. Set GEMINI_API_KEY in .env."
    });
  }

  const { imageBase64, previousContext, timestamp } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== "string") {
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
      return res.status(502).json({ error: "Invalid response from Gemini." });
    }

    return res.json({ data: parsed, raw: responseText });
  } catch (error) {
    console.error("Gemini analyze-frame error:", error);
    return res.status(500).json({
      error: "Failed to analyze frame.",
      details: error.message || "Unknown error"
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
