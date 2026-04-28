import base64
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from ultralytics import YOLO


PERSON_CLASS_ID = 0
SPORTS_BALL_CLASS_ID = 32
DEFAULT_MODEL_PATH = "yolo11n.pt"
DEFAULT_TRACKER = "bytetrack.yaml"
BALL_CARRIER_THRESHOLD_PX = 120.0
MAX_TRACK_HISTORY = 256


class AnalyzeRequest(BaseModel):
  imageBase64: str
  previousContext: Optional[str] = None
  timestamp: Optional[str] = "unknown"


@dataclass
class Detection:
  track_id: int
  class_id: int
  center: Tuple[float, float]
  box: Tuple[float, float, float, float]


class TacticalEngine:
  def __init__(self) -> None:
    self.last_positions: Dict[int, Tuple[float, float]] = {}
    self.last_ball_pair: Optional[Tuple[int, int]] = None

  def _distance(self, a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))

  def _assign_teams(self, players: List[Detection]) -> Dict[int, int]:
    if not players:
      return {}
    median_x = float(np.median([p.center[0] for p in players]))
    return {p.track_id: (0 if p.center[0] <= median_x else 1) for p in players}

  def _ball_carrier(
    self, players: List[Detection], ball_center: Optional[Tuple[float, float]]
  ) -> Optional[Detection]:
    if not players or ball_center is None:
      return None
    best = min(players, key=lambda p: self._distance(p.center, ball_center))
    if self._distance(best.center, ball_center) > BALL_CARRIER_THRESHOLD_PX:
      return None
    return best

  def _nearest_defender(
    self, players: List[Detection], teams: Dict[int, int], ball_carrier: Detection
  ) -> Optional[Detection]:
    opponents = [
      p
      for p in players
      if p.track_id != ball_carrier.track_id
      and teams.get(p.track_id) != teams.get(ball_carrier.track_id)
    ]
    if not opponents:
      return None
    return min(opponents, key=lambda p: self._distance(p.center, ball_carrier.center))

  def _off_ball_pairs(
    self,
    players: List[Detection],
    teams: Dict[int, int],
    used_ids: set
  ) -> List[Dict[str, str]]:
    team_a = [p for p in players if teams.get(p.track_id) == 0 and p.track_id not in used_ids]
    team_b = [p for p in players if teams.get(p.track_id) == 1 and p.track_id not in used_ids]
    pairs: List[Dict[str, str]] = []

    for offensive in team_a:
      if not team_b:
        break
      defender = min(team_b, key=lambda p: self._distance(p.center, offensive.center))
      team_b = [p for p in team_b if p.track_id != defender.track_id]
      pairs.append(
        {"offense_id": str(offensive.track_id), "defense_id": str(defender.track_id)}
      )
      if len(pairs) >= 2:
        break

    return pairs

  def _movement_note(
    self,
    players: List[Detection],
    frame_w: int,
    frame_h: int
  ) -> str:
    if not players:
      return "No tracked players in frame."

    center_x = frame_w / 2.0
    center_y = frame_h / 2.0
    best_id = None
    best_delta = 0.0

    for player in players:
      prev = self.last_positions.get(player.track_id)
      if not prev:
        continue
      prev_dist = self._distance(prev, (center_x, center_y))
      now_dist = self._distance(player.center, (center_x, center_y))
      delta = prev_dist - now_dist
      if delta > best_delta:
        best_delta = delta
        best_id = player.track_id

    if best_id is not None and best_delta > 8:
      return f"Player {best_id} is moving toward the paint."
    return "Defensive spacing remains stable in this sampled frame."

  def _update_history(self, players: List[Detection]) -> None:
    for player in players:
      self.last_positions[player.track_id] = player.center
    if len(self.last_positions) > MAX_TRACK_HISTORY:
      # Keep memory bounded for long sessions.
      keep_ids = set([p.track_id for p in players])
      for track_id in list(self.last_positions.keys()):
        if track_id not in keep_ids:
          del self.last_positions[track_id]

  def evaluate(
    self,
    players: List[Detection],
    ball_center: Optional[Tuple[float, float]],
    timestamp: str,
    frame_w: int,
    frame_h: int
  ) -> Dict:
    if len(players) < 4:
      self._update_history(players)
      return {
        "timestamp": timestamp,
        "status": "no_gameplay",
        "ball_matchup": {
          "offense_id": "unknown",
          "defense_id": "unknown",
          "action": "Holding"
        },
        "off_ball_matchups": [],
        "tactical_event": "None",
        "notes": "Insufficient tracked players for gameplay analysis."
      }

    teams = self._assign_teams(players)
    carrier = self._ball_carrier(players, ball_center)
    defender = self._nearest_defender(players, teams, carrier) if carrier else None

    offense_id = str(carrier.track_id) if carrier else "unknown"
    defense_id = str(defender.track_id) if defender else "unknown"
    used_ids = set()
    if carrier:
      used_ids.add(carrier.track_id)
    if defender:
      used_ids.add(defender.track_id)

    off_ball = self._off_ball_pairs(players, teams, used_ids)
    tactical_event = "None"
    current_pair = (
      (carrier.track_id, defender.track_id) if carrier and defender else None
    )
    if self.last_ball_pair and current_pair and current_pair != self.last_ball_pair:
      tactical_event = "Switch Detected"
    self.last_ball_pair = current_pair

    notes = self._movement_note(players, frame_w, frame_h)
    self._update_history(players)

    return {
      "timestamp": timestamp,
      "status": "active_gameplay",
      "ball_matchup": {
        "offense_id": offense_id,
        "defense_id": defense_id,
        "action": "Dribbling" if carrier else "Holding"
      },
      "off_ball_matchups": off_ball,
      "tactical_event": tactical_event,
      "notes": notes
    }


def decode_image(image_base64: str) -> np.ndarray:
  try:
    raw = base64.b64decode(image_base64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
      raise ValueError("Unable to decode image.")
    return frame
  except Exception as exc:
    raise HTTPException(status_code=400, detail=f"Invalid imageBase64 payload: {exc}") from exc


def extract_detections(track_result) -> Tuple[List[Detection], Optional[Tuple[float, float]]]:
  players: List[Detection] = []
  ball_center = None

  if track_result.boxes is None or len(track_result.boxes) == 0:
    return players, ball_center

  boxes_xyxy = track_result.boxes.xyxy.cpu().numpy()
  class_ids = track_result.boxes.cls.cpu().numpy().astype(int)
  track_ids = (
    track_result.boxes.id.cpu().numpy().astype(int)
    if track_result.boxes.id is not None
    else np.array([-1] * len(class_ids))
  )

  for i, class_id in enumerate(class_ids):
    x1, y1, x2, y2 = boxes_xyxy[i]
    center = ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

    if class_id == PERSON_CLASS_ID and track_ids[i] >= 0:
      players.append(
        Detection(
          track_id=int(track_ids[i]),
          class_id=int(class_id),
          center=center,
          box=(float(x1), float(y1), float(x2), float(y2))
        )
      )
    elif class_id == SPORTS_BALL_CLASS_ID and ball_center is None:
      ball_center = center

  return players, ball_center


app = FastAPI(title="Local Basketball Vision Server")
model = YOLO(DEFAULT_MODEL_PATH)
engine = TacticalEngine()


@app.get("/health")
def health() -> Dict[str, str]:
  return {
    "status": "ok",
    "model": DEFAULT_MODEL_PATH,
    "tracker": DEFAULT_TRACKER
  }


@app.post("/analyze-frame")
def analyze_frame(payload: AnalyzeRequest) -> Dict:
  frame = decode_image(payload.imageBase64)

  track_results = model.track(
    source=frame,
    persist=True,
    tracker=DEFAULT_TRACKER,
    verbose=False
  )
  if not track_results:
    raise HTTPException(status_code=500, detail="No inference result returned by model.")

  track_result = track_results[0]
  players, ball_center = extract_detections(track_result)
  h, w = frame.shape[:2]

  tactical_json = engine.evaluate(
    players=players,
    ball_center=ball_center,
    timestamp=payload.timestamp or "unknown",
    frame_w=w,
    frame_h=h
  )

  return {"data": tactical_json}
