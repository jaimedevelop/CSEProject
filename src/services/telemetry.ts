// src/services/telemetry.ts
// Shared API fetch logic for Dashboard, Map, and FlightLogs.

const API_BASE = 'http://127.0.0.1:8000';

export interface TelemetryPacket {
    timestamp: string;
    latitude: number;
    longitude: number;
    altitude_m: number;
    temperature_c: number;
    pressure_hpa: number;
    accel_x: number;
    accel_y: number;
    accel_z: number;
    rssi: number | null;
    snr: number | null;
    wind_gust_mph: number | null;
    source: string | null;
}

export type FetchState =
    | { status: 'loading' }
    | { status: 'ok'; data: TelemetryPacket }
    | { status: 'no_data' }       // 404 — backend up, no packet yet
    | { status: 'error' };        // network / server error

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

// Utility conversions — keep transforms out of components
export const metersToFeet = (m: number) => m * 3.28084;