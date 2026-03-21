# backend/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os
import requests
from datetime import datetime
from sqlalchemy import create_engine, Column, String, Float, Integer, Boolean, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.sql import func

app = FastAPI(title="Telemetry API")

# Allow the Vite dev server to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LISTENER_CONTROL_URL = os.environ.get("LISTENER_CONTROL_URL", "http://127.0.0.1:8765/control/pop")

# ─── Database Setup ──────────────────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), "telemetry.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class TelemetryPacketDB(Base):
    __tablename__ = "telemetry_packets"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(String, index=True)
    log_date = Column(String, index=True)  # YYYY-MM-DD for date-based queries
    latitude = Column(Float)
    longitude = Column(Float)
    altitude_m = Column(Float)
    temperature_c = Column(Float)
    humidity_pct = Column(Float, nullable=True)
    pressure_hpa = Column(Float)
    accel_x = Column(Float)
    accel_y = Column(Float)
    accel_z = Column(Float)
    rssi = Column(Integer, nullable=True)
    snr = Column(Float, nullable=True)
    speed_mps = Column(Float, nullable=True)
    heading_deg = Column(Float, nullable=True)
    satellites_in_view = Column(Integer, nullable=True)
    battery_pct = Column(Float, nullable=True)
    stability_index = Column(Float, nullable=True)
    det = Column(Boolean, nullable=True)
    det_reason = Column(Integer, nullable=True)
    det_reason_text = Column(String, nullable=True)
    wind_gust_mph = Column(Float, nullable=True)
    source = Column(String, default="lora")
    created_at = Column(DateTime, server_default=func.now())

# Create tables on startup
Base.metadata.create_all(bind=engine)

# In-memory store of the latest telemetry packet for efficient polling
latest_telemetry: Optional[dict] = None


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
    
    # Extract log_date from timestamp
    ts = packet.timestamp
    if isinstance(ts, str) and ts:
        try:
            normalized = ts.replace("Z", "+00:00")
            log_date = datetime.fromisoformat(normalized).date().isoformat()
        except ValueError:
            log_date = datetime.utcnow().strftime("%Y-%m-%d")
    else:
        log_date = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Save to database
    db = SessionLocal()
    try:
        db_packet = TelemetryPacketDB(
            timestamp=packet.timestamp,
            log_date=log_date,
            latitude=packet.latitude,
            longitude=packet.longitude,
            altitude_m=packet.altitude_m,
            temperature_c=packet.temperature_c,
            humidity_pct=packet.humidity_pct,
            pressure_hpa=packet.pressure_hpa,
            accel_x=packet.accel_x,
            accel_y=packet.accel_y,
            accel_z=packet.accel_z,
            rssi=packet.rssi,
            snr=packet.snr,
            speed_mps=packet.speed_mps,
            heading_deg=packet.heading_deg,
            satellites_in_view=packet.satellites_in_view,
            battery_pct=packet.battery_pct,
            stability_index=packet.stability_index,
            det=packet.det,
            det_reason=packet.det_reason,
            det_reason_text=packet.det_reason_text,
            wind_gust_mph=packet.wind_gust_mph,
            source=packet.source or "lora",
        )
        db.add(db_packet)
        db.commit()
    finally:
        db.close()
    
    return {"status": "ok", "received_at": packet.timestamp}


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
    
    db = SessionLocal()
    try:
        packets = db.query(TelemetryPacketDB).filter(
            TelemetryPacketDB.log_date == target_date
        ).order_by(TelemetryPacketDB.id).all()
        
        packet_dicts = [
            {
                "timestamp": p.timestamp,
                "latitude": p.latitude,
                "longitude": p.longitude,
                "altitude_m": p.altitude_m,
                "temperature_c": p.temperature_c,
                "humidity_pct": p.humidity_pct,
                "pressure_hpa": p.pressure_hpa,
                "accel_x": p.accel_x,
                "accel_y": p.accel_y,
                "accel_z": p.accel_z,
                "rssi": p.rssi,
                "snr": p.snr,
                "speed_mps": p.speed_mps,
                "heading_deg": p.heading_deg,
                "satellites_in_view": p.satellites_in_view,
                "battery_pct": p.battery_pct,
                "stability_index": p.stability_index,
                "det": p.det,
                "det_reason": p.det_reason,
                "det_reason_text": p.det_reason_text,
                "wind_gust_mph": p.wind_gust_mph,
                "source": p.source,
            }
            for p in packets
        ]
        return {"date": target_date, "packets": packet_dicts}
    finally:
        db.close()


# -------------------------------------------------------------------
# GET /health  — quick sanity check
# -------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "running"}