require("dotenv").config();
const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const VISION_SERVER_URL =
  process.env.VISION_SERVER_URL || "http://127.0.0.1:8000/analyze-frame";
const VISION_SERVER_TIMEOUT_MS = Number(process.env.VISION_SERVER_TIMEOUT_MS || 30000);
const appLogs = [];
const MAX_APP_LOGS = 200;

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

app.post("/api/analyze-frame", async (req, res) => {
  const { imageBase64, previousContext, timestamp } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== "string") {
    addAppLog("warn", "Invalid analyze-frame request payload");
    return res.status(400).json({ error: "imageBase64 is required." });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VISION_SERVER_TIMEOUT_MS);

    let visionResponse;
    try {
      visionResponse = await fetch(VISION_SERVER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64,
          previousContext: previousContext ?? null,
          timestamp: timestamp ?? "unknown"
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const result = await visionResponse.json();
    if (!visionResponse.ok) {
      addAppLog("error", "Vision server analyze-frame error", {
        status: visionResponse.status,
        details: result?.details || result?.error || "unknown"
      });
      return res.status(visionResponse.status).json(result);
    }

    const parsed = result?.data;
    if (!parsed || typeof parsed !== "object") {
      addAppLog("error", "Vision server returned invalid payload");
      return res.status(502).json({
        error: "Invalid response from vision server.",
        details: "Expected an object in `data`."
      });
    }

    addAppLog("info", "Frame analyzed", {
      timestamp: timestamp ?? "unknown",
      status: parsed.status ?? "unknown"
    });
    return res.json({
      data: parsed,
      raw: JSON.stringify(parsed)
    });
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    const status = isTimeout ? 504 : 500;
    const details = isTimeout
      ? "Vision server request timed out."
      : error?.message || "Unknown error";

    addAppLog("error", "Vision proxy analyze-frame error", {
      status,
      details
    });

    return res.status(status).json({
      error: "Failed to analyze frame.",
      details,
      status
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
    visionServer: VISION_SERVER_URL
  });
});
