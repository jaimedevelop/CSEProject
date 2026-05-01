# backend/listener.py
# Reads telemetry from either:
#   SIM_MODE=True  → spawns simulator.py as a subprocess and reads its stdout
#   SIM_MODE=False → reads from the RAK4630 base station over USB serial
# Parsed packets are POSTed to the FastAPI server as JSON.

from __future__ import annotations
import argparse
import os
import sys
import json
import subprocess
import time
import threading
import requests
import serial          # pip install pyserial
import serial.tools.list_ports
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone

# =============================================================================
# CONFIG — toggle SIM_MODE here, or set env var: SIM_MODE=1 python listener.py
# =============================================================================
SIM_MODE    = 0  # True = simulator
SERIAL_PORT = os.environ.get("SERIAL_PORT", "")        # e.g. COM3 or /dev/ttyUSB0
BAUD_RATE   = int(os.environ.get("BAUD_RATE", "115200"))
API_URL     = os.environ.get("API_URL", "http://127.0.0.1:8000/telemetry")
CONTROL_HOST = os.environ.get("LISTENER_CONTROL_HOST", "127.0.0.1")
CONTROL_PORT = int(os.environ.get("LISTENER_CONTROL_PORT", "8765"))
DEMO_INTERVAL_S = float(os.environ.get("LISTENER_DEMO_INTERVAL", "1.0"))
# =============================================================================

DEMO_SCENARIO: str | None = None
DEMO_BASELINE_PACKETS = 4
PRESSURE_DROP_STEADY_PACKETS = 15
WIND40_GRADUAL_PACKETS = 12
MANUAL_DEFLATE_DESCENT_PACKETS = 20

SCENARIO_BAT20 = "bat20"
SCENARIO_BAT5 = "bat5"
SCENARIO_RSSI110 = "rssi110"
SCENARIO_PRESSURE_DROP = "pressuredrop"
SCENARIO_WIND40 = "wind40"
SCENARIO_MANUAL_DEFLATE = "manualdeflate"

DET_REASON_LABELS = {
    0: "NONE",
    1: "MANUAL_POP",
    2: "LOW_BATTERY",
    3: "GEOFENCE_EXIT",
    4: "ALTITUDE_DROP",
}

serial_lock = threading.Lock()
active_serial: serial.Serial | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Telemetry listener (serial/simulator) with optional alert-demo scenarios.",
    )

    parser.add_argument(
        "--sim",
        action="store_true",
        help="Force simulator subprocess mode.",
    )

    parser.add_argument(
        "--serial",
        action="store_true",
        help="Force serial mode (default when no demo flag is used).",
    )

    demo_group = parser.add_mutually_exclusive_group()
    demo_group.add_argument(
        "--bat20",
        action="store_true",
        help="Emit demo telemetry that triggers battery-low alert (<20%%).",
    )
    demo_group.add_argument(
        "--bat5",
        action="store_true",
        help="Emit demo telemetry for critical battery/auto-pop (<5%%).",
    )
    demo_group.add_argument(
        "--rssi110",
        action="store_true",
        help="Emit demo telemetry that triggers RSSI alert (< -110 dBm).",
    )
    demo_group.add_argument(
        "--pressuredrop",
        action="store_true",
        help="Emit demo telemetry for pressure-drop warning (>1.5 mb/hour over 30 min).",
    )
    demo_group.add_argument(
        "--wind40",
        action="store_true",
        help="Emit demo telemetry for calculated wind gust alert (>40 mph).",
    )
    demo_group.add_argument(
        "--manualdeflate",
        action="store_true",
        help="Emit demo telemetry with det=true and a slow manual-deflation descent.",
    )

    return parser.parse_args()


def select_demo_scenario(args: argparse.Namespace) -> str | None:
    if args.bat20:
        return SCENARIO_BAT20
    if args.bat5:
        return SCENARIO_BAT5
    if args.rssi110:
        return SCENARIO_RSSI110
    if args.pressuredrop:
        return SCENARIO_PRESSURE_DROP
    if args.wind40:
        return SCENARIO_WIND40
    if args.manualdeflate:
        return SCENARIO_MANUAL_DEFLATE
    return None


def cycle_value(values: list[float], packet_index: int) -> float:
    return values[packet_index % len(values)]


def build_demo_packet(scenario: str, packet_index: int) -> dict:
    # Base values stay realistic enough for dashboard visuals while remaining deterministic.
    common_altitude_offsets = [0.0, 0.1, -0.1, 0.2, -0.2]
    common_temperature_offsets = [0.0, 0.1, -0.1, 0.2, -0.2]
    common_pressure_offsets = [0.0, 0.1, -0.1]
    common_snr_offsets = [0.0, 0.1, -0.1, 0.2, -0.2]
    common_rssi_offsets = [0, 1, -1, 0, -1]

    alt_jitter = cycle_value(common_altitude_offsets, packet_index)
    temp_jitter = cycle_value(common_temperature_offsets, packet_index)
    pressure_jitter = cycle_value(common_pressure_offsets, packet_index)
    snr_jitter = cycle_value(common_snr_offsets, packet_index)
    rssi_jitter = int(cycle_value(common_rssi_offsets, packet_index))

    packet = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "latitude": 27.865935,
        "longitude": -82.241438,
        "altitude_m": round(0.0 + alt_jitter, 1),
        "temperature_c": round(42.0 + temp_jitter, 1),
        "humidity_pct": 42.0,
        "pressure_hpa": round(1019.3 + pressure_jitter, 1),
        "accel_x": 0.12,
        "accel_y": -0.08,
        "accel_z": 9.79,
        "rssi": -45 + rssi_jitter,
        "snr": round(12.0 + snr_jitter, 1),
        "speed_mps": 8.0,
        "heading_deg": 274.0,
        "satellites_in_view": 18,
        "battery_pct": 64.0,
        "stability_index": round(99.0 + cycle_value([0.0, 0.4, -0.3, 0.2, -0.2], packet_index), 1),
        "det": False,
        "det_reason": 0,
        "det_reason_text": "NONE",
        "wind_gust_mph": None,
    }

    in_baseline_phase = packet_index < DEMO_BASELINE_PACKETS
    phase_index = packet_index - DEMO_BASELINE_PACKETS

    if scenario == SCENARIO_BAT20:
        if in_baseline_phase:
            packet["battery_pct"] = cycle_value([20.2, 20.1, 20.2], packet_index)
        else:
            packet["battery_pct"] = cycle_value([19.9, 19.8, 19.7, 19.8], phase_index)
    elif scenario == SCENARIO_BAT5:
        if in_baseline_phase:
            packet["battery_pct"] = cycle_value([5.3, 5.2, 5.3, 5.2, 5.1], packet_index)
            packet["det"] = False
            packet["det_reason"] = 0
            packet["det_reason_text"] = "NONE"
        else:
            packet["battery_pct"] = cycle_value([4.9, 4.8, 4.7, 4.8, 4.0, 3.9], phase_index)
            packet["det"] = True
            packet["det_reason"] = 2
            packet["det_reason_text"] = "LOW_BATTERY"
    elif scenario == SCENARIO_RSSI110:
        if in_baseline_phase:
            packet["rssi"] = int(cycle_value([-108, -107, -109, -108], packet_index))
        else:
            packet["rssi"] = int(cycle_value([-112, -114, -113, -115], phase_index))
    elif scenario == SCENARIO_PRESSURE_DROP:
        if in_baseline_phase:
            packet["pressure_hpa"] = round(cycle_value([1017.2, 1017.0, 1016.9, 1017.1], packet_index), 1)
            packet["pressure_drop_rate_mb_per_hr"] = round(cycle_value([1.2, 1.3, 1.1, 1.25], packet_index), 2)
            packet["pressure_drop_warning"] = False
        elif phase_index < PRESSURE_DROP_STEADY_PACKETS:
            # Keep pressure mostly steady for a while so the trend is visible before it drops.
            packet["pressure_hpa"] = round(cycle_value([1017.1, 1017.0, 1016.9, 1017.0], phase_index), 1)
            packet["pressure_drop_rate_mb_per_hr"] = round(cycle_value([1.15, 1.2, 1.1, 1.25], phase_index), 2)
            packet["pressure_drop_warning"] = False
        else:
            drop_step = phase_index - PRESSURE_DROP_STEADY_PACKETS
            # Gradually decrease pressure and increase drop rate to cross alert threshold over time.
            pressure_base = 1016.8 - (0.08 * drop_step)
            rate_base = 1.22 + (0.05 * drop_step)
            packet["pressure_hpa"] = round(pressure_base + cycle_value([0.1, 0.0, -0.1, 0.0], phase_index), 1)
            packet["pressure_drop_rate_mb_per_hr"] = round(min(2.1, rate_base + cycle_value([0.02, 0.0, -0.02, 0.01], phase_index)), 2)
            packet["pressure_drop_warning"] = packet["pressure_drop_rate_mb_per_hr"] > 1.5
    elif scenario == SCENARIO_WIND40:
        if in_baseline_phase:
            # Baseline: low tilt, normal speed, high stability
            packet["speed_mps"] = cycle_value([3.0, 3.2, 2.9, 3.1], packet_index)
            packet["accel_x"] = cycle_value([0.20, 0.25, 0.18, 0.22], packet_index)
            packet["accel_y"] = cycle_value([0.15, 0.12, 0.18, 0.14], packet_index)
            packet["accel_z"] = cycle_value([9.76, 9.73, 9.79, 9.75], packet_index)
            packet["stability_index"] = round(98.5 + cycle_value([0.0, 0.3, -0.2, 0.1], packet_index), 1)
        elif phase_index < WIND40_GRADUAL_PACKETS:
            # Gradual transition: tilt increases, stability decreases linearly
            ramp_step = phase_index / WIND40_GRADUAL_PACKETS
            accel_x_base = 0.5 + (13.5 * ramp_step)  # Ramp from 0.5 to ~14.0 (≈50 mph)
            stability_base = 98.0 - (50.0 * ramp_step)  # Ramp from 98 to ~48
            packet["speed_mps"] = round(cycle_value([3.0, 3.2, 2.9, 3.1], phase_index), 1)
            packet["accel_x"] = round(accel_x_base + cycle_value([0.3, 0.2, -0.3, 0.1], phase_index), 2)
            packet["accel_y"] = cycle_value([0.3, 0.1, 0.2, 0.15], phase_index)
            packet["accel_z"] = cycle_value([9.76, 9.73, 9.79, 9.75], phase_index)  # Keep normal gravity
            packet["stability_index"] = round(stability_base + cycle_value([0.5, 0.0, -0.5, 0.2], phase_index), 1)
        else:
            # High wind alert phase: sustained high tilt, low stability
            packet["speed_mps"] = cycle_value([3.1, 3.2, 3.0, 3.1], phase_index)
            packet["accel_x"] = cycle_value([11.31, 12.61, 13.97, 12.90], phase_index)
            packet["accel_y"] = cycle_value([0.2, 0.1, 0.15, 0.1], phase_index)
            packet["accel_z"] = cycle_value([9.76, 9.73, 9.79, 9.75], phase_index)  # Keep normal gravity
            packet["stability_index"] = round(47.0 + cycle_value([0.5, -0.5, 0.3, -0.2], phase_index), 1)
    elif scenario == SCENARIO_MANUAL_DEFLATE:
        descent_step = min(packet_index, MANUAL_DEFLATE_DESCENT_PACKETS)
        altitude_base = 72.0 - (2.8 * descent_step)
        pressure_base = 1019.3 + (0.33 * descent_step)  # Pressure increases as altitude decreases

        packet["det"] = True
        packet["det_reason"] = 1
        packet["det_reason_text"] = "MANUAL_POP"
        packet["altitude_m"] = round(max(0.0, altitude_base + cycle_value([0.2, 0.0, -0.2, 0.1], packet_index)), 1)
        packet["pressure_hpa"] = round(pressure_base + cycle_value([0.1, 0.0, -0.1, 0.0], packet_index), 1)
        packet["speed_mps"] = cycle_value([4.2, 4.0, 4.4, 4.1], packet_index)
        packet["accel_x"] = cycle_value([0.4, 0.5, 0.3, 0.4], packet_index)
        packet["accel_y"] = cycle_value([0.2, 0.1, 0.15, 0.1], packet_index)
        packet["accel_z"] = cycle_value([9.76, 9.73, 9.79, 9.75], packet_index)
        packet["battery_pct"] = cycle_value([63.8, 63.7, 63.9, 63.8], packet_index)

    return packet


def run_demo_mode(scenario: str):
    print(f"[listener] DEMO_MODE=ON — scenario '{scenario}' (interval={DEMO_INTERVAL_S:.1f}s)")
    print(f"[listener] Sending {DEMO_BASELINE_PACKETS} baseline packets before alert condition")
    packet_index = 0
    try:
        while True:
            packet = build_demo_packet(scenario, packet_index)
            post_packet(packet)
            packet_index += 1
            time.sleep(DEMO_INTERVAL_S)
    except KeyboardInterrupt:
        print("[listener] Demo mode stopped.")


def send_pop_command() -> tuple[bool, str]:
    """Send POP over the active serial link, if available."""
    if SIM_MODE:
        print("[listener] SIM_MODE=ON — accepted POP command (simulated)")
        return True, "POP accepted in simulator mode"

    with serial_lock:
        if active_serial is None or not active_serial.is_open:
            return False, "Serial link is not connected"

        try:
            active_serial.write(b"POP\n")
            active_serial.flush()
            print("[listener] POP command sent over serial")
            return True, "POP command sent"
        except serial.SerialException as e:
            return False, f"Failed to write POP command: {e}"


def send_reset_command() -> tuple[bool, str]:
    """Send RESET over the active serial link, if available."""
    if SIM_MODE:
        print("[listener] SIM_MODE=ON — accepted RESET command (simulated)")
        return True, "RESET accepted in simulator mode"

    with serial_lock:
        if active_serial is None or not active_serial.is_open:
            return False, "Serial link is not connected"

        try:
            active_serial.write(b"RESET\n")
            active_serial.flush()
            print("[listener] RESET command sent over serial")
            return True, "RESET command sent"
        except serial.SerialException as e:
            return False, f"Failed to write RESET command: {e}"


def send_geofence_command(latitude: float, longitude: float, radius: float, max_altitude: float) -> tuple[bool, str]:
    """Send GEOFENCE over the active serial link.
    
    Format: GEOFENCE,<lat>,<lon>,<radius>,<maxAlt>
    Latitude and longitude are in degrees * 1e7 (integer format).
    Radius is in meters.
    Max altitude is sent in millimeters.
    """
    if SIM_MODE:
        print("[listener] SIM_MODE=ON — accepted GEOFENCE command (simulated)")
        return True, "GEOFENCE accepted in simulator mode"

    # Convert to integer format (degrees * 1e7)
    lat_long = int(latitude * 1e7)
    lon_long = int(longitude * 1e7)
    radius_long = int(radius)
    alt_long = int(max_altitude * 1000)

    command = f"GEOFENCE,{lat_long},{lon_long},{radius_long},{alt_long}\n"

    with serial_lock:
        if active_serial is None or not active_serial.is_open:
            return False, "Serial link is not connected"

        try:
            active_serial.write(command.encode("utf-8"))
            active_serial.flush()
            print(f"[listener] GEOFENCE command sent over serial: {command.strip()}")
            return True, "GEOFENCE command sent"
        except serial.SerialException as e:
            return False, f"Failed to write GEOFENCE command: {e}"


class ControlRequestHandler(BaseHTTPRequestHandler):
    """Small local control API so the backend can trigger serial commands."""

    def _send_json(self, status_code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/control/pop":
            ok, message = send_pop_command()
            if ok:
                self._send_json(200, {"status": "ok", "message": message})
            else:
                self._send_json(409, {"status": "error", "error": message})
        elif self.path == "/control/reset":
            ok, message = send_reset_command()
            if ok:
                self._send_json(200, {"status": "ok", "message": message})
            else:
                self._send_json(409, {"status": "error", "error": message})
        elif self.path == "/control/geofence":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode("utf-8"))
                latitude = float(data.get("latitude"))
                longitude = float(data.get("longitude"))
                radius = float(data.get("radius"))
                max_altitude = float(data.get("max_altitude"))
                ok, message = send_geofence_command(latitude, longitude, radius, max_altitude)
                if ok:
                    self._send_json(200, {"status": "ok", "message": message})
                else:
                    self._send_json(409, {"status": "error", "error": message})
            except (json.JSONDecodeError, ValueError, KeyError) as e:
                self._send_json(400, {"status": "error", "error": f"Invalid geofence data: {e}"})
        else:
            self._send_json(404, {"error": "Not found"})

    def log_message(self, format: str, *args):
        # Keep output focused on telemetry/control events.
        return


def start_control_server():
    server = ThreadingHTTPServer((CONTROL_HOST, CONTROL_PORT), ControlRequestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"[listener] Control API listening on http://{CONTROL_HOST}:{CONTROL_PORT}/control/pop, /control/reset, and /control/geofence")


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

            satellites_raw = raw_packet.get("siv")
            if satellites_raw is None:
                satellites_raw = raw_packet.get("satellites_in_view")
            if satellites_raw is None:
                satellites_raw = raw_packet.get("satellitesInView")
            if satellites_raw is None:
                satellites_raw = raw_packet.get("satellites")

            try:
                satellites_in_view = int(satellites_raw) if satellites_raw is not None else None
            except (TypeError, ValueError):
                satellites_in_view = None

            det_reason = int(raw_packet.get("detReason", 0))
            det_reason_text = DET_REASON_LABELS.get(det_reason, f"UNKNOWN_{det_reason}")

            battery_pct = raw_packet.get("batt")
            if battery_pct is None:
                battery_pct = raw_packet.get("battery")
            if battery_pct is None:
                battery_pct = raw_packet.get("batteryPct")

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
                "satellites_in_view": satellites_in_view,
                "battery_pct":   battery_pct,
                "stability_index": raw_packet.get("stability"),
                "det":           bool(raw_packet.get("det", False)),
                "det_reason":    det_reason,
                "det_reason_text": det_reason_text,
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
    return"/dev/tty.usbmodem1101"

def run_serial_mode():
    global active_serial
    port = SERIAL_PORT or auto_detect_port()
    if not port:
        print("[listener] ERROR: No serial port found. Set SERIAL_PORT env var.", file=sys.stderr)
        sys.exit(1)

    print(f"[listener] SIM_MODE=OFF — opening serial port {port} @ {BAUD_RATE} baud")
    while True:   # reconnect loop
        ser = None
        try:
            with serial.Serial(port, BAUD_RATE, timeout=2) as ser:
                with serial_lock:
                    active_serial = ser
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
        finally:
            with serial_lock:
                if ser is not None and active_serial is ser:
                    active_serial = None


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    args = parse_args()
    DEMO_SCENARIO = select_demo_scenario(args)

    if args.sim:
        SIM_MODE = 1
    elif args.serial:
        SIM_MODE = 0

    start_control_server()

    if DEMO_SCENARIO is not None:
        run_demo_mode(DEMO_SCENARIO)
    elif SIM_MODE:
        run_sim_mode()
    else:
        run_serial_mode()