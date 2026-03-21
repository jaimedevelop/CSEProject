# backend/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import json
import os
import requests
from datetime import datetime

app = FastAPI(title="Telemetry API")

# Allow the Vite dev server to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FLIGHT_LOGS_DIR = os.path.join(os.path.dirname(__file__), "flight_logs")
os.makedirs(FLIGHT_LOGS_DIR, exist_ok=True)
LISTENER_CONTROL_URL = os.environ.get("LISTENER_CONTROL_URL", "http://127.0.0.1:8765/control/pop")

# In-memory store of the latest telemetry packet
latest_telemetry: Optional[dict] = None


def _packet_log_date(packet: dict) -> str:
    """Choose the log file date using packet timestamp when possible."""
    ts = packet.get("timestamp")
    if isinstance(ts, str) and ts:
        try:
            # Accept both ...+00:00 and ...Z timestamp forms.
            normalized = ts.replace("Z", "+00:00")
            return datetime.fromisoformat(normalized).date().isoformat()
        except ValueError:
            pass
    return datetime.utcnow().strftime("%Y-%m-%d")


# -------------------------------------------------------------------
# Pydantic model — update fields to match your actual RAK4630 payload
# -------------------------------------------------------------------
class TelemetryPacket(BaseModel):
    timestamp: str
    latitude: float
    longitude: float
    altitude_m: float
    temperature_c: float
    humidity_pct: Optional[float] = None
    pressure_hpa: float
    accel_x: float
    accel_y: float
    accel_z: float
    rssi: Optional[int] = None       # signal strength, LoRa only
    snr: Optional[float] = None      # signal-to-noise ratio, LoRa only
    speed_mps: Optional[float] = None
    heading_deg: Optional[float] = None
    satellites_in_view: Optional[int] = None
    battery_pct: Optional[float] = None
    stability_index: Optional[float] = None
    det: Optional[bool] = None
    det_reason: Optional[int] = None
    det_reason_text: Optional[str] = None
    wind_gust_mph: Optional[float] = None  # simulator compatibility
    source: Optional[str] = "lora"   # "lora" | "serial" | "simulator"


# -------------------------------------------------------------------
# POST /telemetry  — listener.py calls this whenever a packet arrives
# -------------------------------------------------------------------
@app.post("/telemetry", status_code=201)
async def receive_telemetry(packet: TelemetryPacket):
    global latest_telemetry
    latest_telemetry = packet.model_dump()

    # Persist every packet to a daily log file.
    log_filename = _packet_log_date(latest_telemetry) + ".jsonl"
    log_path = os.path.join(FLIGHT_LOGS_DIR, log_filename)
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(latest_telemetry) + "\n")

    return {"status": "ok", "received_at": latest_telemetry["timestamp"]}


# POST /deflate for manual deflation command
@app.post("/deflate")
def deflate():
    try:
        listener_resp = requests.post(LISTENER_CONTROL_URL, timeout=3)
    except requests.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Listener control unavailable: {e}") from e

    try:
        listener_payload = listener_resp.json()
    except ValueError:
        listener_payload = {"raw": listener_resp.text}

    if listener_resp.status_code >= 400:
        detail = listener_payload.get("error") or listener_payload.get("message") or "Listener rejected POP command"
        raise HTTPException(status_code=listener_resp.status_code, detail=detail)

    return {
        "status": "ok",
        "message": "Deflation command relayed",
        "listener": listener_payload,
    }

# -------------------------------------------------------------------
# GET /telemetry/latest  — dashboard polls this every 30 s
# -------------------------------------------------------------------
@app.get("/telemetry/latest")
async def get_latest_telemetry():
    if latest_telemetry is None:
        raise HTTPException(status_code=404, detail="No telemetry received yet")
    return latest_telemetry


# -------------------------------------------------------------------
# GET /telemetry/history  — flight logs page
# -------------------------------------------------------------------
@app.get("/telemetry/history")
async def get_telemetry_history(date: Optional[str] = None):
    """
    Returns all packets for a given date (YYYY-MM-DD).
    Defaults to today if no date param is provided.
    """
    target_date = date or datetime.utcnow().strftime("%Y-%m-%d")
    log_path = os.path.join(FLIGHT_LOGS_DIR, f"{target_date}.jsonl")

    if not os.path.exists(log_path):
        return {"date": target_date, "packets": []}

    packets = []
    with open(log_path, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                packets.append(json.loads(line))

    return {"date": target_date, "packets": packets}


# -------------------------------------------------------------------
# GET /health  — quick sanity check
# -------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "running"}