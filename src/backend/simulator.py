# backend/simulator.py
import time
import json
import math
import random
import sys
from datetime import datetime, timezone

BASE_LAT  = 0
BASE_LON  = 0
MAX_ALT   = 3000.0    # metres
INTERVAL  = 30        # seconds between packets

def simulate_flight():
    t = 0
    total_flight = 1800  # 30 min

    while True:
        progress = min(t / total_flight, 1.0)
        altitude = MAX_ALT * math.sin(math.pi * progress)

        lat = BASE_LAT + (progress * 0.05) + random.uniform(-0.0002, 0.0002)
        lon = BASE_LON + (progress * 0.03) + random.uniform(-0.0002, 0.0002)
        temperature = round(25.0 - (altitude / 1000.0) * 6.5 + random.uniform(-0.3, 0.3), 2)
        pressure    = round(1013.25 * math.exp(-altitude / 8500.0) + random.uniform(-0.5, 0.5), 2)
        accel_x     = round(random.uniform(-0.15, 0.15), 3)
        accel_y     = round(random.uniform(-0.15, 0.15), 3)
        accel_z     = round(9.81 + random.uniform(-0.05, 0.05), 3)

        packet = {
            "timestamp":     datetime.now(timezone.utc).isoformat(),
            "latitude":      round(lat, 6),
            "longitude":     round(lon, 6),
            "altitude_m":    round(altitude, 2),
            "temperature_c": temperature,
            "pressure_hpa":  pressure,
            "accel_x":       accel_x,
            "accel_y":       accel_y,
            "accel_z":       accel_z,
            "rssi":          random.randint(-120, -60),
            "snr":           round(random.uniform(3.0, 10.0), 1),
            "satellites_in_view": random.randint(6, 18),
        }

        sys.stdout.write(json.dumps(packet) + "\n")
        sys.stdout.flush()

        t += INTERVAL
        time.sleep(INTERVAL)

if __name__ == "__main__":
    print(f"[simulator] Starting. Emitting packets every {INTERVAL}s. Ctrl+C to stop.", file=sys.stderr)
    try:
        simulate_flight()
    except KeyboardInterrupt:
        print("[simulator] Stopped.", file=sys.stderr)