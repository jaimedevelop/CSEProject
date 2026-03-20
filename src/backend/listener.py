# backend/listener.py
# Reads telemetry from either:
#   SIM_MODE=True  → spawns simulator.py as a subprocess and reads its stdout
#   SIM_MODE=False → reads from the RAK4630 base station over USB serial
# Parsed packets are POSTed to the FastAPI server as JSON.

from __future__ import annotations
import os
import sys
import json
import subprocess
import time
import requests
import serial          # pip install pyserial
import serial.tools.list_ports
from datetime import datetime, timezone

# =============================================================================
# CONFIG — toggle SIM_MODE here, or set env var: SIM_MODE=1 python listener.py
# =============================================================================
SIM_MODE    = 0  # True = simulator
SERIAL_PORT = os.environ.get("SERIAL_PORT", "")        # e.g. COM3 or /dev/ttyUSB0
BAUD_RATE   = int(os.environ.get("BAUD_RATE", "115200"))
API_URL     = os.environ.get("API_URL", "http://127.0.0.1:8000/telemetry")
# =============================================================================

DET_REASON_LABELS = {
    0: "NONE",
    1: "MANUAL_POP",
    2: "LOW_BATTERY",
    3: "GEOFENCE_EXIT",
    4: "ALTITUDE_DROP",
}


def post_packet(packet: dict):
    """Send a telemetry packet to the FastAPI backend."""
    try:
        resp = requests.post(API_URL, json=packet, timeout=5)
        resp.raise_for_status()
        print(f"[listener] Posted packet → {resp.status_code} | {packet}")
    except requests.RequestException as e:
        print(f"[listener] Failed to POST packet: {e}", file=sys.stderr)


def parse_line(raw: str) -> dict | None:
    """
    Parse a raw JSON line from the serial port and normalize it to
    the backend telemetry schema.
    """
    raw = raw.strip()
    if not raw:
        return None

    if raw.startswith("{") and raw.endswith("}"):
        try:
            raw_packet = json.loads(raw)

            # The u-blox GPS module sends coordinates as (degrees * 10^7)
            # We divide by 10,000,000 to get standard decimal coordinates
            lat_decimal = float(raw_packet.get("lat", 0)) / 10000000.0
            lon_decimal = float(raw_packet.get("lon", 0)) / 10000000.0

            # The GPS altitude is in millimeters, convert to meters
            alt_meters = float(raw_packet.get("alt", 0)) / 1000.0

            # speed is mm/s and heading is degrees * 1e5
            speed_mps = float(raw_packet.get("speed", 0)) / 1000.0
            heading_deg = float(raw_packet.get("heading", 0)) / 100000.0

            det_reason = int(raw_packet.get("detReason", 0))
            det_reason_text = DET_REASON_LABELS.get(det_reason, f"UNKNOWN_{det_reason}")

            # Map C++ payload keys to backend API keys
            translated_packet = {
                "timestamp":     datetime.now(timezone.utc).isoformat(),
                "latitude":      lat_decimal,
                "longitude":     lon_decimal,
                "altitude_m":    alt_meters,
                "temperature_c": raw_packet.get("tempC", 0.0),
                "humidity_pct":  raw_packet.get("humidity"),
                "pressure_hpa":  raw_packet.get("pressure", 0.0),
                "accel_x":       raw_packet.get("accelX", 0.0),
                "accel_y":       raw_packet.get("accelY", 0.0),
                "accel_z":       raw_packet.get("accelZ", 0.0),
                "rssi":          raw_packet.get("rssi", 0),
                "snr":           raw_packet.get("snr", 0.0),
                "speed_mps":     speed_mps,
                "heading_deg":   heading_deg,
                "satellites_in_view": raw_packet.get("siv"),
                "battery_pct":   raw_packet.get("batt"),
                "stability_index": raw_packet.get("stability"),
                "det":           bool(raw_packet.get("det", False)),
                "det_reason":    det_reason,
                "det_reason_text": det_reason_text,
                "wind_gust_mph": None,  # simulator-only field
                "source":        "lora_radio"
            }
            
            return translated_packet

        except json.JSONDecodeError as e:
            print(f"[listener] JSON decode error: {e}\n  raw: {raw}", file=sys.stderr)
    else:
        # Print non-JSON debug statements from the C++ code to the console
        print(f"[ground_station_log] {raw}")

    return None


# ---------------------------------------------------------------------------
# SIM MODE — spawn simulator.py and read its stdout line by line
# ---------------------------------------------------------------------------
def run_sim_mode():
    print("[listener] SIM_MODE=ON — spawning simulator.py")
    sim_path = os.path.join(os.path.dirname(__file__), "simulator.py")
    proc = subprocess.Popen(
        [sys.executable, sim_path],
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        text=True,
        bufsize=1,
    )
    try:
        for line in proc.stdout:
            packet = parse_line(line)
            if packet:
                post_packet(packet)
    except KeyboardInterrupt:
        proc.terminate()
        print("[listener] Stopped.")


# ---------------------------------------------------------------------------
# REAL MODE — read from RAK4630 base station over USB serial
# ---------------------------------------------------------------------------
def auto_detect_port() -> str:
    return "COM9"

def run_serial_mode():
    port = SERIAL_PORT or auto_detect_port()
    if not port:
        print("[listener] ERROR: No serial port found. Set SERIAL_PORT env var.", file=sys.stderr)
        sys.exit(1)

    print(f"[listener] SIM_MODE=OFF — opening serial port {port} @ {BAUD_RATE} baud")
    while True:   # reconnect loop
        try:
            with serial.Serial(port, BAUD_RATE, timeout=2) as ser:
                print(f"[listener] Connected to {port}")
                while True:
                    raw = ser.readline().decode("utf-8", errors="replace")
                    packet = parse_line(raw)
                    if packet:
                        post_packet(packet)
        except serial.SerialException as e:
            print(f"[listener] Serial error: {e}. Retrying in 5s…", file=sys.stderr)
            time.sleep(5)
        except KeyboardInterrupt:
            print("[listener] Stopped.")
            break


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    if SIM_MODE:
        run_sim_mode()
    else:
        run_serial_mode()