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

# =============================================================================
# CONFIG — toggle SIM_MODE here, or set env var: SIM_MODE=1 python listener.py
# =============================================================================
SIM_MODE    = os.environ.get("SIM_MODE", "1") == "1"   # True = simulator
SERIAL_PORT = os.environ.get("SERIAL_PORT", "")        # e.g. COM3 or /dev/ttyUSB0
BAUD_RATE   = int(os.environ.get("BAUD_RATE", "115200"))
API_URL     = os.environ.get("API_URL", "http://127.0.0.1:8000/telemetry")
# =============================================================================


def post_packet(packet: dict):
    """Send a telemetry packet to the FastAPI backend."""
    try:
        resp = requests.post(API_URL, json=packet, timeout=5)
        resp.raise_for_status()
        print(f"[listener] Posted packet → {resp.status_code} | alt={packet.get('altitude_m')}m")
    except requests.RequestException as e:
        print(f"[listener] Failed to POST packet: {e}", file=sys.stderr)


def parse_line(raw: str) -> dict | None:
    """
    Parse a raw line from the serial port or simulator.

    The simulator emits clean JSON, so this just does json.loads().
    For the real RAK4630 (RUI3 firmware), the base station typically
    prints lines like:
        +EVT:RX_1, RSSI=-87, SNR=7.5, PLD=<hex or JSON string>
    Adjust the parsing block below once you know your exact firmware output.
    """
    raw = raw.strip()
    if not raw:
        return None

    # --- Simulator / already-JSON path ---
    if raw.startswith("{"):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

    # --- RAK4630 RUI3 AT-command firmware path ---
    # Example line: +EVT:RX_1, RSSI=-87, SNR=7.5, PLD={"lat":27.99,...}
    if "+EVT" in raw and "PLD=" in raw:
        try:
            rssi, snr = None, None
            if "RSSI=" in raw:
                rssi = int(raw.split("RSSI=")[1].split(",")[0].strip())
            if "SNR=" in raw:
                snr = float(raw.split("SNR=")[1].split(",")[0].strip())

            payload_str = raw.split("PLD=")[1].strip()
            packet = json.loads(payload_str)
            packet.setdefault("rssi", rssi)
            packet.setdefault("snr", snr)
            packet.setdefault("source", "lora")
            return packet
        except (IndexError, json.JSONDecodeError, ValueError) as e:
            print(f"[listener] Could not parse RAK4630 line: {e}\n  raw: {raw}", file=sys.stderr)

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
    """Try to find the RAK4630 USB serial port automatically."""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = (p.description or "").lower()
        if "rak" in desc or "cp210" in desc or "ch340" in desc or "ftdi" in desc:
            print(f"[listener] Auto-detected port: {p.device} ({p.description})")
            return p.device
    # Fall back to first available port
    if ports:
        print(f"[listener] Using first available port: {ports[0].device}")
        return ports[0].device
    return ""

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