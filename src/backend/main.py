# backend/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os
import math
import requests
from datetime import datetime, timedelta
from uuid import uuid4
from sqlalchemy import create_engine, Column, String, Float, Integer, Boolean, DateTime, text
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
    flight_id = Column(String, index=True, nullable=True)
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
    calculated_wind_gust_mph = Column(Float, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class FlightDB(Base):
    __tablename__ = "flights"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    started_at = Column(String, nullable=False)
    ended_at = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

# Create tables on startup
Base.metadata.create_all(bind=engine)


def ensure_schema_compatibility() -> None:
    """Lightweight SQLite migrations for additive columns used by newer telemetry payloads."""
    with engine.begin() as conn:
        rows = conn.execute(text("PRAGMA table_info(telemetry_packets)")).fetchall()
        existing_cols = {row[1] for row in rows}

        if "satellites_in_view" not in existing_cols:
            conn.execute(text("ALTER TABLE telemetry_packets ADD COLUMN satellites_in_view INTEGER"))

        if "flight_id" not in existing_cols:
            conn.execute(text("ALTER TABLE telemetry_packets ADD COLUMN flight_id TEXT"))

        if "calculated_wind_gust_mph" not in existing_cols:
            conn.execute(text("ALTER TABLE telemetry_packets ADD COLUMN calculated_wind_gust_mph FLOAT"))

        if "source" in existing_cols:
            try:
                conn.execute(text("ALTER TABLE telemetry_packets DROP COLUMN source"))
            except Exception:
                # Older SQLite builds may not support DROP COLUMN; treat as best-effort cleanup.
                pass


ensure_schema_compatibility()

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


class FlightSummary(BaseModel):
    id: str
    name: str
    started_at: str
    ended_at: Optional[str] = None
    packet_count: int


def get_active_flight(db) -> Optional[FlightDB]:
    return db.query(FlightDB).filter(FlightDB.ended_at.is_(None)).order_by(FlightDB.created_at.desc()).first()


def serialize_packet(p: TelemetryPacketDB) -> dict:
    return {
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
        "calculated_wind_gust_mph": p.calculated_wind_gust_mph,
    }


def calculate_wind_gust_mph(packet: TelemetryPacket) -> float:
    """Estimate gust intensity from GPS speed and non-gravity acceleration."""
    speed_mph = max(0.0, (packet.speed_mps or 0.0) * 2.23694)
    accel_mag = math.sqrt((packet.accel_x ** 2) + (packet.accel_y ** 2) + (packet.accel_z ** 2))

    # Payloads may report accel in g (~1.0 at rest) or m/s^2 (~9.81 at rest).
    # Normalize to deviation-from-1g to avoid false large gusts when units are g.
    if accel_mag <= 3.0:
        accel_deviation_g = abs(accel_mag - 1.0)
    else:
        accel_deviation_g = abs((accel_mag / 9.81) - 1.0)

    # Convert acceleration disturbance to an equivalent gust contribution.
    accel_component_mph = accel_deviation_g * 18.0
    calc_gust = speed_mph + accel_component_mph

    return round(calc_gust, 1)


def compute_pressure_drop_3h_mb(db, flight_id: str, current_pressure_hpa: float) -> float:
    three_hours_ago = datetime.utcnow() - timedelta(hours=3)
    rows = db.query(TelemetryPacketDB.pressure_hpa).filter(
        TelemetryPacketDB.flight_id == flight_id,
        TelemetryPacketDB.created_at >= three_hours_ago,
        TelemetryPacketDB.pressure_hpa.isnot(None),
    ).all()

    if not rows:
        return 0.0

    max_recent_pressure = max(float(r[0]) for r in rows if r[0] is not None)
    drop = max_recent_pressure - current_pressure_hpa
    return round(max(0.0, drop), 1)


def serialize_flight(flight: FlightDB, packet_count: int) -> dict:
    return {
        "id": flight.id,
        "name": flight.name,
        "started_at": flight.started_at,
        "ended_at": flight.ended_at,
        "packet_count": packet_count,
    }


# -------------------------------------------------------------------
# POST /telemetry  — listener.py calls this whenever a packet arrives
# -------------------------------------------------------------------
@app.post("/telemetry", status_code=201)
async def receive_telemetry(packet: TelemetryPacket):
    global latest_telemetry
    active_flight_id: Optional[str] = None
    
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
        calculated_wind_gust_mph = calculate_wind_gust_mph(packet)
        active_flight = get_active_flight(db)

        pressure_drop_3h_mb = 0.0
        pressure_drop_warning = False
        if active_flight is not None:
            pressure_drop_3h_mb = compute_pressure_drop_3h_mb(db, active_flight.id, packet.pressure_hpa)
            pressure_drop_warning = pressure_drop_3h_mb > 4.0 and packet.pressure_hpa < 1009.0

        wind_gust_warning = calculated_wind_gust_mph > 40.0

        latest_telemetry = packet.model_dump()
        latest_telemetry["calculated_wind_gust_mph"] = calculated_wind_gust_mph
        latest_telemetry["pressure_drop_3h_mb"] = pressure_drop_3h_mb
        latest_telemetry["pressure_drop_warning"] = pressure_drop_warning
        latest_telemetry["wind_gust_warning"] = wind_gust_warning

        if active_flight is None:
            return {
                "status": "ok",
                "received_at": packet.timestamp,
                "saved": False,
                "message": "No active flight; packet not persisted",
            }

        active_flight_id = active_flight.id

        db_packet = TelemetryPacketDB(
            flight_id=active_flight_id,
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
            calculated_wind_gust_mph=calculated_wind_gust_mph,
        )
        db.add(db_packet)
        db.commit()
    finally:
        db.close()

    return {
        "status": "ok",
        "received_at": packet.timestamp,
        "saved": True,
        "flight_id": active_flight_id,
    }


@app.post("/flights/start")
async def start_flight():
    db = SessionLocal()
    try:
        active = get_active_flight(db)
        if active is not None:
            count = db.query(TelemetryPacketDB).filter(TelemetryPacketDB.flight_id == active.id).count()
            return {"status": "ok", "flight": serialize_flight(active, count), "already_active": True}

        now_iso = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
        flight_id = f"flight_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:6]}"
        flight_name = f"Flight {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}"

        flight = FlightDB(
            id=flight_id,
            name=flight_name,
            started_at=now_iso,
            ended_at=None,
        )
        db.add(flight)
        db.commit()
        return {"status": "ok", "flight": serialize_flight(flight, 0), "already_active": False}
    finally:
        db.close()


@app.post("/flights/end")
async def end_flight():
    db = SessionLocal()
    try:
        active = get_active_flight(db)
        if active is None:
            return {"status": "ok", "flight": None, "message": "No active flight"}

        active.ended_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
        db.commit()
        count = db.query(TelemetryPacketDB).filter(TelemetryPacketDB.flight_id == active.id).count()
        return {"status": "ok", "flight": serialize_flight(active, count)}
    finally:
        db.close()


@app.get("/flights/status")
async def flight_status():
    db = SessionLocal()
    try:
        active = get_active_flight(db)
        if active is None:
            return {"active": None}

        count = db.query(TelemetryPacketDB).filter(TelemetryPacketDB.flight_id == active.id).count()
        return {"active": serialize_flight(active, count)}
    finally:
        db.close()


@app.get("/flights")
async def list_flights():
    db = SessionLocal()
    try:
        flights = db.query(FlightDB).order_by(FlightDB.created_at.desc()).all()
        items = []
        for f in flights:
            count = db.query(TelemetryPacketDB).filter(TelemetryPacketDB.flight_id == f.id).count()
            items.append(serialize_flight(f, count))
        return {"flights": items}
    finally:
        db.close()


@app.get("/flights/{flight_id}/packets")
async def get_flight_packets(flight_id: str):
    db = SessionLocal()
    try:
        flight = db.query(FlightDB).filter(FlightDB.id == flight_id).first()
        if flight is None:
            raise HTTPException(status_code=404, detail="Flight not found")

        packets = db.query(TelemetryPacketDB).filter(
            TelemetryPacketDB.flight_id == flight_id
        ).order_by(TelemetryPacketDB.id).all()

        return {
            "flight": serialize_flight(flight, len(packets)),
            "packets": [serialize_packet(p) for p in packets],
        }
    finally:
        db.close()


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
        
        packet_dicts = [serialize_packet(p) for p in packets]
        return {"date": target_date, "packets": packet_dicts}
    finally:
        db.close()


# -------------------------------------------------------------------
# GET /health  — quick sanity check
# -------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "running"}