// src/services/telemetry.ts
// Shared API fetch logic for Dashboard, Map, and FlightLogs.

const API_BASE = 'http://127.0.0.1:8000';

export interface TelemetryPacket {
    timestamp: string;
    latitude: number;
    longitude: number;
    altitude_m: number;
    temperature_c: number;
    humidity_pct?: number | null;
    pressure_hpa: number;
    accel_x: number;
    accel_y: number;
    accel_z: number;
    rssi: number | null;
    snr: number | null;
    speed_mps?: number | null;
    heading_deg?: number | null;
    satellites_in_view?: number | null;
    battery_pct?: number | null;
    stability_index?: number | null;
    det?: boolean | null;
    det_reason?: number | null;
    det_reason_text?: string | null;
    wind_gust_mph: number | null; // kept for simulator compat; may be null on real hardware
    calculated_wind_gust_mph?: number | null;
    pressure_drop_3h_mb?: number | null;
    pressure_drop_warning?: boolean | null;
    wind_gust_warning?: boolean | null;
}

export interface FlightSummary {
    id: string;
    name: string;
    started_at: string;
    ended_at?: string | null;
    packet_count: number;
    geofence_latitude?: number | null;
    geofence_longitude?: number | null;
    geofence_radius_m?: number | null;
    geofence_max_altitude_m?: number | null;
}

export interface FlightMapSelection {
    flightId: string;
}

export type FetchState =
    | { status: 'loading' }
    | { status: 'ok'; data: TelemetryPacket }
    | { status: 'no_data' }   // 404 — backend up, no packet yet
    | { status: 'error' };    // network / server error

export async function fetchLatestTelemetry(): Promise<FetchState> {
    try {
        const res = await fetch(`${API_BASE}/telemetry/latest`, { cache: 'no-store' });
        if (res.status === 404) return { status: 'no_data' };
        if (!res.ok) return { status: 'error' };
        const data: TelemetryPacket = await res.json();
        return { status: 'ok', data };
    } catch {
        return { status: 'error' };
    }
}

/** Fetch all packets for a given date (YYYY-MM-DD). Returns [] on any error. */
export async function fetchTelemetryHistory(date: string): Promise<TelemetryPacket[]> {
    try {
        const res = await fetch(`${API_BASE}/telemetry/history?date=${date}`, { cache: 'no-store' });
        if (!res.ok) return [];
        const data: unknown = await res.json();
        if (Array.isArray(data)) {
            return data as TelemetryPacket[];
        }

        if (data && typeof data === 'object' && 'packets' in data) {
            const packets = (data as { packets?: unknown }).packets;
            return Array.isArray(packets) ? (packets as TelemetryPacket[]) : [];
        }

        return [];
    } catch {
        return [];
    }
}

/** Returns today's date as YYYY-MM-DD in local time. */
export function todayDateString(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Unit conversions ─────────────────────────────────────────────────────────

export const metersToFeet = (m: number) => m * 3.28084;

export const GROUND_PRESSURE_STORAGE_KEY = 'dashboardGroundPressureHpa';

export function calculateBarometricAltitudeMeters(
    pressureHpa: number | null | undefined,
    groundPressureHpa: number | null | undefined,
): number | null {
    if (pressureHpa == null || groundPressureHpa == null) return null;
    if (pressureHpa <= 0 || groundPressureHpa <= 0) return null;
    // International barometric formula for altitude relative to calibrated ground pressure.
    return 44330 * (1 - Math.pow(pressureHpa / groundPressureHpa, 1 / 5.255));
}

export function getGroundPressureCalibration(): number | null {
    const saved = localStorage.getItem(GROUND_PRESSURE_STORAGE_KEY);
    if (!saved) return null;
    const parsed = Number(saved);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

export function saveGroundPressureCalibration(pressureHpa: number): void {
    localStorage.setItem(GROUND_PRESSURE_STORAGE_KEY, pressureHpa.toString());
}

export function getDisplayAltitudeMeters(
    packet: Pick<TelemetryPacket, 'pressure_hpa'>,
    groundPressureHpa?: number | null,
): number | null {
    const baseline = groundPressureHpa ?? getGroundPressureCalibration();
    return calculateBarometricAltitudeMeters(packet.pressure_hpa, baseline);
}

/**
 * Derives a tilt angle (°) from accelerometer axes.
 * When the device is flat and upright, accel_z ≈ 9.8 m/s².
 * Tilt away from vertical increases the XY component.
 */
export function tiltAngle(ax: number, ay: number, az: number): number {
    const xy = Math.sqrt(ax ** 2 + ay ** 2);
    return Math.atan2(xy, Math.abs(az)) * (180 / Math.PI);
}

export type DeflateResult =
    | { ok: true; message: string }
    | { ok: false; message: string };

export async function triggerManualDeflation(): Promise<DeflateResult> {
    try {
        const res = await fetch(`${API_BASE}/deflate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        const data: unknown = await res.json().catch(() => ({}));
        const msgFromBody = data && typeof data === 'object'
            ? (data as { detail?: string; message?: string }).detail ?? (data as { detail?: string; message?: string }).message
            : undefined;

        if (!res.ok) {
            return { ok: false, message: msgFromBody ?? `Request failed (${res.status})` };
        }

        return { ok: true, message: msgFromBody ?? 'Deflation command sent' };
    } catch {
        return { ok: false, message: 'Unable to reach backend' };
    }
}

export async function triggerFirmwareReset(): Promise<DeflateResult> {
    try {
        const res = await fetch(`${API_BASE}/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        const data: unknown = await res.json().catch(() => ({}));
        const msgFromBody = data && typeof data === 'object'
            ? (data as { detail?: string; message?: string }).detail ?? (data as { detail?: string; message?: string }).message
            : undefined;

        if (!res.ok) {
            return { ok: false, message: msgFromBody ?? `Request failed (${res.status})` };
        }

        return { ok: true, message: msgFromBody ?? 'Reset command sent' };
    } catch {
        return { ok: false, message: 'Unable to reach backend' };
    }
}

export type GeofenceResult =
    | { ok: true; message: string }
    | { ok: false; message: string };

export async function sendGeofence(latitude: number, longitude: number, radius: number, maxAltitude: number): Promise<GeofenceResult> {
    try {
        const res = await fetch(`${API_BASE}/geofence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude, longitude, radius, max_altitude: maxAltitude }),
        });

        const data: unknown = await res.json().catch(() => ({}));
        const msgFromBody = data && typeof data === 'object'
            ? (data as { detail?: string; message?: string }).detail ?? (data as { detail?: string; message?: string }).message
            : undefined;

        if (!res.ok) {
            return { ok: false, message: msgFromBody ?? `Request failed (${res.status})` };
        }

        return { ok: true, message: msgFromBody ?? 'Geofence set successfully' };
    } catch {
        return { ok: false, message: 'Unable to reach backend' };
    }
}

export async function fetchFlightStatus(): Promise<FlightSummary | null> {
    try {
        const res = await fetch(`${API_BASE}/flights/status`, { cache: 'no-store' });
        if (!res.ok) return null;
        const data: unknown = await res.json();
        if (data && typeof data === 'object' && 'active' in data) {
            const active = (data as { active?: unknown }).active;
            return active && typeof active === 'object' ? (active as FlightSummary) : null;
        }
        return null;
    } catch {
        return null;
    }
}

export async function startFlight(geofence?: {
    latitude: number;
    longitude: number;
    radius: number;
    maxAltitude: number;
}): Promise<FlightSummary | null> {
    try {
        const res = await fetch(`${API_BASE}/flights/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geofence ? {
                geofence_latitude: geofence.latitude,
                geofence_longitude: geofence.longitude,
                geofence_radius_m: geofence.radius,
                geofence_max_altitude_m: geofence.maxAltitude,
            } : {}),
        });
        if (!res.ok) return null;
        const data: unknown = await res.json();
        if (data && typeof data === 'object' && 'flight' in data) {
            const flight = (data as { flight?: unknown }).flight;
            return flight && typeof flight === 'object' ? (flight as FlightSummary) : null;
        }
        return null;
    } catch {
        return null;
    }
}

export async function endFlight(): Promise<FlightSummary | null> {
    try {
        const res = await fetch(`${API_BASE}/flights/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return null;
        const data: unknown = await res.json();
        if (data && typeof data === 'object' && 'flight' in data) {
            const flight = (data as { flight?: unknown }).flight;
            return flight && typeof flight === 'object' ? (flight as FlightSummary) : null;
        }
        return null;
    } catch {
        return null;
    }
}

export async function fetchFlights(): Promise<FlightSummary[]> {
    try {
        const res = await fetch(`${API_BASE}/flights`, { cache: 'no-store' });
        if (!res.ok) return [];
        const data: unknown = await res.json();
        if (data && typeof data === 'object' && 'flights' in data) {
            const flights = (data as { flights?: unknown }).flights;
            return Array.isArray(flights) ? (flights as FlightSummary[]) : [];
        }
        return [];
    } catch {
        return [];
    }
}

export async function fetchFlightPackets(flightId: string): Promise<{ flight: FlightSummary | null; packets: TelemetryPacket[] }> {
    try {
        const res = await fetch(`${API_BASE}/flights/${encodeURIComponent(flightId)}/packets`, { cache: 'no-store' });
        if (!res.ok) return { flight: null, packets: [] };

        const data: unknown = await res.json();
        if (!data || typeof data !== 'object') return { flight: null, packets: [] };

        const flight = 'flight' in data && (data as { flight?: unknown }).flight && typeof (data as { flight?: unknown }).flight === 'object'
            ? ((data as { flight?: unknown }).flight as FlightSummary)
            : null;

        const packetsRaw = 'packets' in data ? (data as { packets?: unknown }).packets : [];
        const packets = Array.isArray(packetsRaw) ? (packetsRaw as TelemetryPacket[]) : [];

        return { flight, packets };
    } catch {
        return { flight: null, packets: [] };
    }
}

const MAP_REPLAY_KEY = 'mapReplaySelection';

export function setMapReplaySelection(selection: FlightMapSelection | null): void {
    if (!selection) {
        localStorage.removeItem(MAP_REPLAY_KEY);
        return;
    }
    localStorage.setItem(MAP_REPLAY_KEY, JSON.stringify(selection));
}

export function getMapReplaySelection(): FlightMapSelection | null {
    try {
        const raw = localStorage.getItem(MAP_REPLAY_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'flightId' in parsed) {
            const flightId = (parsed as { flightId?: unknown }).flightId;
            if (typeof flightId === 'string' && flightId.length > 0) {
                return { flightId };
            }
        }
        return null;
    } catch {
        return null;
    }
}