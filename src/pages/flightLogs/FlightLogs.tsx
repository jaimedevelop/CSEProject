import { useState, useEffect, useMemo, useCallback } from 'react';
import '../../styles/theme.css';
import {
    fetchTelemetryHistory,
    metersToFeet,
    tiltAngle,
    type TelemetryPacket,
} from '../../services/telemetry';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function exportCSV(packets: TelemetryPacket[]) {
    const headers = [
        'timestamp', 'latitude', 'longitude', 'altitude_m', 'altitude_ft',
        'temperature_c', 'pressure_hpa',
        'accel_x', 'accel_y', 'accel_z', 'tilt_deg', 'stability_index',
        'rssi', 'snr', 'wind_gust_mph', 'source',
    ];
    const rows = packets.map(p => [
        p.timestamp,
        p.latitude.toFixed(6),
        p.longitude.toFixed(6),
        p.altitude_m.toFixed(2),
        metersToFeet(p.altitude_m).toFixed(2),
        p.temperature_c.toFixed(2),
        p.pressure_hpa.toFixed(2),
        p.accel_x.toFixed(3),
        p.accel_y.toFixed(3),
        p.accel_z.toFixed(3),
        tiltAngle(p.accel_x, p.accel_y, p.accel_z).toFixed(1),
        p.stability_index != null ? p.stability_index.toFixed(2) : '',
        p.rssi ?? '',
        p.snr ?? '',
        p.wind_gust_mph ?? '',
        p.source ?? '',
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flight_log_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
    return (
        <div className="card" style={{ minWidth: 130 }}>
            <div className="card-title">{label}</div>
            <div style={{ marginTop: 'var(--space-2)' }}>
                <span className="data-value" style={{ fontSize: 'var(--text-xl)' }}>{value}</span>
                {unit && <span className="data-unit">{unit}</span>}
            </div>
            {sub && <div className="data-label">{sub}</div>}
        </div>
    );
}

// ─── FlightLogs ───────────────────────────────────────────────────────────────

export default function FlightLogs() {
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [packets, setPackets] = useState<TelemetryPacket[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);

    useEffect(() => {
        setDate(new Date().toISOString().slice(0, 10));
    }, []);

    const loadHistory = useCallback(async (withLoading: boolean) => {
        if (withLoading) setLoading(true);
        setError(false);
        try {
            const data = await fetchTelemetryHistory(date);
            setPackets(data);
            if (withLoading) setLoading(false);
        } catch {
            setError(true);
            if (withLoading) setLoading(false);
        }
    }, [date]);

    useEffect(() => {
        loadHistory(true);
    }, [loadHistory]);

    useEffect(() => {
        const interval = setInterval(() => {
            loadHistory(false);
        }, 1000);
        return () => clearInterval(interval);
    }, [loadHistory]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        if (!q) return packets;
        return packets.filter(p =>
            (p.source ?? '').toLowerCase().includes(q) ||
            p.latitude.toFixed(6).includes(q) ||
            p.longitude.toFixed(6).includes(q)
        );
    }, [packets, search]);

    // ── Summary stats ────────────────────────────────────────────────────────
    const maxAltFt = packets.length
        ? Math.max(...packets.map(p => metersToFeet(p.altitude_m)))
        : null;
    const minRSSI = packets.length
        ? Math.min(...packets.map(p => p.rssi ?? 0))
        : null;
    const firstPacket = packets[0] ?? null;
    const lastPacket = packets[packets.length - 1] ?? null;
    const flightMinutes = (firstPacket && lastPacket && firstPacket !== lastPacket)
        ? Math.round((new Date(lastPacket.timestamp).getTime() - new Date(firstPacket.timestamp).getTime()) / 60_000)
        : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 1200 }}>

            {/* ── Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                <div>
                    <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semi)' }}>Flight Logs</h2>
                    <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
                        {firstPacket ? fmtDate(firstPacket.timestamp) : date} · {packets.length} packets
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                    <input
                        type="date"
                        className="input"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        style={{ maxWidth: 180 }}
                    />
                    <button className="btn btn-primary" onClick={() => exportCSV(filtered)} disabled={filtered.length === 0}>
                        ⬇ Export CSV
                    </button>
                </div>
            </div>

            {/* ── Summary row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-4)' }}>
                <SummaryCard label="Packets" value={`${packets.length}`} />
                <SummaryCard label="Duration" value={flightMinutes != null ? `${flightMinutes}` : '--'} unit="min" />
                <SummaryCard label="Peak Altitude" value={maxAltFt != null ? maxAltFt.toFixed(0) : '--'} unit="ft" />
                <SummaryCard label="Worst RSSI" value={minRSSI != null ? `${minRSSI}` : '--'} unit="dBm" />
                <SummaryCard
                    label="Last Position"
                    value={lastPacket ? `${lastPacket.latitude.toFixed(4)}°` : '--'}
                    sub={lastPacket ? `${Math.abs(lastPacket.longitude).toFixed(4)}° W` : undefined}
                />
            </div>

            {/* ── Status banners ── */}
            {loading && (
                <div className="alert-banner alert-banner-info">
                    <span>⏳</span><span>Loading packets for {date}…</span>
                </div>
            )}
            {!loading && error && (
                <div className="alert-banner alert-banner-warning">
                    <span>⚠️</span><span>Could not reach the backend. Check that FastAPI is running.</span>
                </div>
            )}
            {!loading && !error && packets.length === 0 && (
                <div className="alert-banner alert-banner-info">
                    <span>📭</span><span>No packets recorded for {date}.</span>
                </div>
            )}

            {/* ── Search ── */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                <input
                    className="input"
                    type="text"
                    placeholder="Search by source, lat, lng…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ maxWidth: 300 }}
                />
                {search && (
                    <span className="text-xs text-muted">{filtered.length} of {packets.length} shown</span>
                )}
            </div>

            {/* ── Log Table ── */}
            <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg-panel)', borderBottom: '1px solid var(--color-border)' }}>
                                {['Time', 'Alt (ft)', 'Temp (°C)', 'Pressure', 'Tilt (°)', 'Stability', 'RSSI', 'SNR', 'Lat', 'Lng', 'Source'].map(h => (
                                    <th key={h} style={{
                                        padding: 'var(--space-2) var(--space-3)',
                                        textAlign: 'left',
                                        color: 'var(--color-text-secondary)',
                                        fontWeight: 'var(--font-medium)',
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && !loading ? (
                                <tr>
                                    <td colSpan={11} style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                        No packets match the current filter.
                                    </td>
                                </tr>
                            ) : filtered.map(p => {
                                const key = p.timestamp;
                                const isExpanded = expanded === key;
                                const altFt = metersToFeet(p.altitude_m);
                                const tilt = tiltAngle(p.accel_x, p.accel_y, p.accel_z);
                                const rssiWarn = p.rssi != null && p.rssi < -95;
                                const tiltWarn = tilt > 20;

                                return (
                                    <>
                                        <tr
                                            key={key}
                                            onClick={() => setExpanded(isExpanded ? null : key)}
                                            style={{
                                                borderBottom: '1px solid var(--color-border)',
                                                cursor: 'pointer',
                                                transition: 'background var(--transition-fast)',
                                            }}
                                            onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--color-bg-card-hover)')}
                                            onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                                        >
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>
                                                {fmtTime(p.timestamp)}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: altFt > 19000 ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>
                                                {altFt.toFixed(1)}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{p.temperature_c.toFixed(1)}</td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{p.pressure_hpa.toFixed(1)}</td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: tiltWarn ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>
                                                {tilt.toFixed(1)}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                                {p.stability_index != null ? p.stability_index.toFixed(2) : '--'}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: rssiWarn ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>
                                                {p.rssi ?? '--'}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: (p.snr ?? 99) < 0 ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                                                {p.snr != null ? p.snr.toFixed(1) : '--'}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{p.latitude.toFixed(5)}</td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{p.longitude.toFixed(5)}</td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)' }}>
                                                {p.source ?? '—'}
                                            </td>
                                        </tr>

                                        {/* Expanded detail row */}
                                        {isExpanded && (
                                            <tr key={`${key}-exp`} style={{ background: 'var(--color-bg-panel)', borderBottom: '1px solid var(--color-border)' }}>
                                                <td colSpan={11} style={{ padding: 'var(--space-3) var(--space-4)' }}>
                                                    <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', fontSize: 'var(--text-xs)' }}>
                                                        {[
                                                            { k: 'Timestamp', v: p.timestamp },
                                                            { k: 'Latitude', v: `${p.latitude.toFixed(6)}°` },
                                                            { k: 'Longitude', v: `${p.longitude.toFixed(6)}°` },
                                                            { k: 'Altitude', v: `${altFt.toFixed(2)} ft (${p.altitude_m.toFixed(2)} m)` },
                                                            { k: 'Temperature', v: `${p.temperature_c.toFixed(2)} °C` },
                                                            { k: 'Pressure', v: `${p.pressure_hpa.toFixed(2)} hPa` },
                                                            { k: 'Accel X', v: `${p.accel_x.toFixed(3)} m/s²` },
                                                            { k: 'Accel Y', v: `${p.accel_y.toFixed(3)} m/s²` },
                                                            { k: 'Accel Z', v: `${p.accel_z.toFixed(3)} m/s²` },
                                                            { k: 'Tilt', v: `${tilt.toFixed(1)}°` },
                                                            { k: 'Stability', v: p.stability_index != null ? p.stability_index.toFixed(2) : '—' },
                                                            { k: 'RSSI', v: p.rssi != null ? `${p.rssi} dBm` : '—' },
                                                            { k: 'SNR', v: p.snr != null ? `${p.snr.toFixed(1)} dB` : '—' },
                                                            { k: 'Source', v: p.source ?? '—' },
                                                        ].map(({ k, v }) => (
                                                            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                                <span style={{ color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</span>
                                                                <span style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{v}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Table footer */}
                <div style={{ padding: 'var(--space-2) var(--space-4)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="text-xs text-muted">
                        {filtered.length} packets · Click any row to expand · Data from GET /telemetry/history?date={date}
                    </span>
                    <span className="text-xs text-muted font-mono">{date}</span>
                </div>
            </div>
        </div>
    );
}