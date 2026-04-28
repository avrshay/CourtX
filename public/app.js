const uploadScreen = document.getElementById("upload-screen");
const dashboardScreen = document.getElementById("dashboard-screen");
const videoInput = document.getElementById("video-input");
const uploadStatus = document.getElementById("upload-status");
const videoPlayer = document.getElementById("video-player");
const logContainer = document.getElementById("log-container");
const appLogContainer = document.getElementById("app-log-container");

const SAMPLE_INTERVAL_MS = 5000;

let captureTimer = null;
let lastContextJson = null;
let selectedVideoUrl = null;
let appLogPoller = null;
let latestAppLogId = null;
let isAnalyzing = false;
let cooldownUntilMs = 0;
let cooldownNotified = false;

const captureCanvas = document.createElement("canvas");
const captureContext = captureCanvas.getContext("2d", { willReadFrequently: false });

function setUploadStatus(message, isError = false) {
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle("error", isError);
}

function showDashboard() {
  uploadScreen.classList.remove("active");
  dashboardScreen.classList.add("active");
}

function formatClockSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function prependSystemRow(text) {
  const row = document.createElement("div");
  row.className = "log-row system-row";
  row.textContent = text;
  logContainer.prepend(row);
}

function parseRetryAfterSeconds(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+)(s)?$/);
  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

function prependAppLogRow(entry) {
  if (!appLogContainer || !entry) {
    return;
  }

  const row = document.createElement("div");
  row.className = `log-row app-log-row ${entry.level || "info"}`;

  const time = entry.at ? new Date(entry.at).toLocaleTimeString() : "unknown";
  const metaText =
    entry.meta && Object.keys(entry.meta).length ? JSON.stringify(entry.meta) : "-";

  row.innerHTML = `
    <div class="row-top">
      <span class="timestamp">${time}</span>
      <span class="status-pill">${entry.level || "info"}</span>
    </div>
    <div class="row-line">${entry.message || "No message"}</div>
    <div class="row-line"><strong>meta:</strong> ${metaText}</div>
  `;

  appLogContainer.prepend(row);
}

function prependGameplayRow(payload) {
  const row = document.createElement("article");
  row.className = "log-row";

  const offBall = Array.isArray(payload.off_ball_matchups)
    ? payload.off_ball_matchups
        .map((m) => `${m.offense_id ?? "?"} vs ${m.defense_id ?? "?"}`)
        .join(" | ")
    : "N/A";

  row.innerHTML = `
    <div class="row-top">
      <span class="timestamp">${payload.timestamp ?? "unknown"}</span>
      <span class="status-pill">active_gameplay</span>
    </div>
    <div class="row-line"><strong>On Ball:</strong> ${payload.ball_matchup?.offense_id ?? "?"} vs ${
    payload.ball_matchup?.defense_id ?? "?"
  } (${payload.ball_matchup?.action ?? "Unknown"})</div>
    <div class="row-line"><strong>Off Ball:</strong> ${offBall}</div>
    <div class="row-line"><strong>Tactical:</strong> ${payload.tactical_event ?? "None"}</div>
    <div class="row-line"><strong>Notes:</strong> ${payload.notes ?? "-"}</div>
  `;

  logContainer.prepend(row);
}

function stopCaptureLoop() {
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }
}

async function captureAndAnalyzeFrame() {
  if (isAnalyzing) {
    return;
  }

  if (cooldownUntilMs > 0) {
    const remainingMs = cooldownUntilMs - Date.now();
    if (remainingMs > 0) {
      if (!cooldownNotified) {
        const remainingSec = Math.ceil(remainingMs / 1000);
        prependSystemRow(`429 cooldown active. Resuming in ~${remainingSec}s.`);
        cooldownNotified = true;
      }
      return;
    }

    cooldownUntilMs = 0;
    if (cooldownNotified) {
      prependSystemRow("429 cooldown ended. Resuming frame analysis.");
    }
    cooldownNotified = false;
  }

  if (
    videoPlayer.paused ||
    videoPlayer.ended ||
    videoPlayer.readyState < 2 ||
    !videoPlayer.videoWidth ||
    !videoPlayer.videoHeight
  ) {
    return;
  }

  captureCanvas.width = videoPlayer.videoWidth;
  captureCanvas.height = videoPlayer.videoHeight;
  captureContext.drawImage(videoPlayer, 0, 0, captureCanvas.width, captureCanvas.height);

  // JPEG compression keeps payload smaller and smoother for frequent uploads.
  const base64Image = captureCanvas.toDataURL("image/jpeg", 0.72).split(",")[1];

  try {
    isAnalyzing = true;
    const response = await fetch("/api/analyze-frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: base64Image,
        previousContext: lastContextJson,
        timestamp: formatClockSeconds(videoPlayer.currentTime)
      })
    });

    const result = await response.json();
    if (!response.ok) {
      const details = [result.error, result.details]
        .filter(Boolean)
        .join(" | ");
      const retry = result.retryAfter ? ` | retry in ${result.retryAfter}` : "";

      if (response.status === 429) {
        if (result.quotaExhausted) {
          // Hard quota exhaustion should not keep hammering the API.
          cooldownUntilMs = Date.now() + 10 * 60 * 1000;
          cooldownNotified = true;
          prependSystemRow(
            "Gemini quota exhausted (limit: 0). Analysis paused for 10 minutes. Enable billing or switch to an API key/project with quota, then reload."
          );
          return;
        }

        const retrySeconds = Math.max(
          parseRetryAfterSeconds(result.retryAfter) ?? 30,
          Math.ceil(SAMPLE_INTERVAL_MS / 1000)
        );
        cooldownUntilMs = Date.now() + retrySeconds * 1000;
        cooldownNotified = true;
        prependSystemRow(
          `API rate limited (429). Pausing analysis for ${retrySeconds}s.${retry}`
        );
        return;
      }

      prependSystemRow(`API error: ${details || "unknown error"}${retry}`);
      return;
    }

    const payload = result.data;
    if (!payload || typeof payload !== "object") {
      prependSystemRow("Malformed Gemini response.");
      return;
    }

    if (payload.status === "no_gameplay") {
      prependSystemRow(`[${formatClockSeconds(videoPlayer.currentTime)}] no gameplay`);
      return;
    }

    if (payload.status === "active_gameplay") {
      lastContextJson = JSON.stringify(payload);
      prependGameplayRow(payload);
      return;
    }

    prependSystemRow("Unknown status from analyzer.");
  } catch (error) {
    prependSystemRow(`Network error: ${error.message}`);
  } finally {
    isAnalyzing = false;
  }
}

function startCaptureLoop() {
  if (captureTimer) {
    return;
  }

  captureAndAnalyzeFrame();
  captureTimer = setInterval(captureAndAnalyzeFrame, SAMPLE_INTERVAL_MS);
}

async function pollAppLogs() {
  try {
    const response = await fetch("/api/app-logs");
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.logs)) {
      return;
    }

    const freshLogs = data.logs
      .filter((entry) => latestAppLogId === null || entry.id > latestAppLogId)
      .reverse();

    for (const entry of freshLogs) {
      prependAppLogRow(entry);
      latestAppLogId = Math.max(latestAppLogId ?? entry.id, entry.id);
    }
  } catch (error) {
    prependSystemRow(`App log poll failed: ${error.message}`);
  }
}

function startAppLogPolling() {
  if (appLogPoller) {
    return;
  }
  pollAppLogs();
  appLogPoller = setInterval(pollAppLogs, 3000);
}

videoInput.addEventListener("change", () => {
  const [file] = videoInput.files || [];
  if (!file) {
    setUploadStatus("No file selected.", true);
    return;
  }

  if (selectedVideoUrl) {
    URL.revokeObjectURL(selectedVideoUrl);
  }

  selectedVideoUrl = URL.createObjectURL(file);
  videoPlayer.src = selectedVideoUrl;
  videoPlayer.load();

  lastContextJson = null;
  cooldownUntilMs = 0;
  cooldownNotified = false;
  isAnalyzing = false;
  logContainer.innerHTML = "";
  if (appLogContainer) {
    appLogContainer.innerHTML = "";
  }

  setUploadStatus(`Loaded: ${file.name}`);
  showDashboard();
  prependSystemRow("Video ready. Press play to start 5-second frame analysis.");
});

videoPlayer.addEventListener("play", () => {
  startCaptureLoop();
});

videoPlayer.addEventListener("pause", () => {
  stopCaptureLoop();
});

videoPlayer.addEventListener("ended", () => {
  stopCaptureLoop();
  prependSystemRow("Playback ended.");
});

window.addEventListener("beforeunload", () => {
  stopCaptureLoop();
  if (appLogPoller) {
    clearInterval(appLogPoller);
  }
  if (selectedVideoUrl) {
    URL.revokeObjectURL(selectedVideoUrl);
  }
});

startAppLogPolling();
