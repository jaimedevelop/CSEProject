#!/usr/bin/env python3
"""Backdate earliest pressure sample for a flight to satisfy pressure-history gating.

Use this in development/demo mode to simulate "30+ minutes of pressure history"
without waiting in real time.
"""

from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Backdate the earliest pressure packet for a flight so pressure-history "
            "checks pass immediately in development."
        )
    )
    parser.add_argument(
        "--db",
        dest="db_path",
        default=str(Path(__file__).with_name("telemetry.db")),
        help="Path to telemetry.db (default: backend/telemetry.db)",
    )
    parser.add_argument(
        "--flight-id",
        dest="flight_id",
        default=None,
        help="Flight ID to patch. If omitted, uses the active flight (ended_at IS NULL).",
    )
    parser.add_argument(
        "--minutes",
        type=int,
        default=31,
        help="How far back to set earliest pressure packet created_at (default: 31)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change without updating the database.",
    )
    return parser.parse_args()


def get_target_flight_id(conn: sqlite3.Connection, requested_flight_id: Optional[str]) -> str:
    if requested_flight_id:
        row = conn.execute("SELECT id FROM flights WHERE id = ?", (requested_flight_id,)).fetchone()
        if not row:
            raise RuntimeError(f"Flight not found: {requested_flight_id}")
        return requested_flight_id

    row = conn.execute(
        """
        SELECT id
        FROM flights
        WHERE ended_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        """
    ).fetchone()

    if not row:
        raise RuntimeError("No active flight found. Start a flight or pass --flight-id.")

    return str(row[0])


def get_earliest_pressure_packet(conn: sqlite3.Connection, flight_id: str) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT id, created_at, pressure_hpa
        FROM telemetry_packets
        WHERE flight_id = ?
          AND pressure_hpa IS NOT NULL
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (flight_id,),
    ).fetchone()

    if not row:
        raise RuntimeError(
            f"No pressure packets found for flight {flight_id}. Send a few telemetry packets first."
        )

    return row


def main() -> int:
    args = parse_args()
    db_path = Path(args.db_path).expanduser().resolve()

    if args.minutes < 1:
        raise RuntimeError("--minutes must be >= 1")

    if not db_path.exists():
        raise RuntimeError(f"Database not found: {db_path}")

    target_ts = (datetime.utcnow() - timedelta(minutes=args.minutes)).strftime("%Y-%m-%d %H:%M:%S")

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row

        flight_id = get_target_flight_id(conn, args.flight_id)
        packet = get_earliest_pressure_packet(conn, flight_id)

        packet_id = int(packet["id"])
        old_created_at = str(packet["created_at"])
        pressure_hpa = float(packet["pressure_hpa"])

        print(f"DB: {db_path}")
        print(f"Flight: {flight_id}")
        print(
            "Earliest pressure packet before patch: "
            f"id={packet_id}, created_at={old_created_at}, pressure_hpa={pressure_hpa:.1f}"
        )
        print(f"New created_at: {target_ts} (UTC)")

        if args.dry_run:
            print("Dry run enabled; no database changes were made.")
            return 0

        conn.execute(
            "UPDATE telemetry_packets SET created_at = ? WHERE id = ?",
            (target_ts, packet_id),
        )
        conn.commit()

        new_row = conn.execute(
            "SELECT id, created_at FROM telemetry_packets WHERE id = ?",
            (packet_id,),
        ).fetchone()

        print(
            "Patch complete: "
            f"id={new_row['id']} now has created_at={new_row['created_at']}"
        )
        print("Pressure-history gate should now be satisfied for this flight.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
