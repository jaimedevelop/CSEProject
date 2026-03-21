import { useState, useEffect, useMemo, useCallback } from 'react';
import '../../styles/theme.css';
import { GeofenceModal, type GeofenceInput } from './GeofenceModal';
import {
    endFlight,
    fetchFlightPackets,
    fetchFlights,
    fetchFlightStatus,
    startFlight,
    sendGeofence,
    tiltAngle,
    type FlightSummary,
    type TelemetryPacket,
} from '../../services/telemetry';

function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDateTime(iso: string) {
    return new Date(iso).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function fmtDuration(startIso: string, endIso?: string | null) {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso ?? new Date().toISOString()).getTime();
    const diffSec = Math.max(0, Math.floor((end - start) / 1000));
    const h = Math.floor(diffSec / 3600);
    const m = Math.floor((diffSec % 3600) / 60);
    const s = diffSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function exportCSV(packets: TelemetryPacket[], flightLabel: string) {
    const headers = [
        'timestamp', 'latitude', 'longitude', 'altitude_m',
        'temperature_c', 'pressure_hpa',
        'accel_x', 'accel_y', 'accel_z', 'tilt_deg', 'stability_index',
        'rssi', 'snr', 'satellites_in_view', 'wind_gust_mph', 'calculated_wind_gust_mph',
    ];

    const rows = packets.map(p => [
        p.timestamp,
        p.latitude.toFixed(6),
        p.longitude.toFixed(6),
        p.altitude_m.toFixed(2),
        p.temperature_c.toFixed(2),
        p.pressure_hpa.toFixed(2),
        p.accel_x.toFixed(3),
        p.accel_y.toFixed(3),
        p.accel_z.toFixed(3),
        tiltAngle(p.accel_x, p.accel_y, p.accel_z).toFixed(1),
        p.stability_index != null ? p.stability_index.toFixed(2) : '',
        p.rssi ?? '',
        p.snr ?? '',
        p.satellites_in_view ?? '',
        p.wind_gust_mph ?? '',
        p.calculated_wind_gust_mph ?? '',
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeLabel = flightLabel.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 64);
    a.href = url;
    a.download = `flight_${safeLabel || Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

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

export default function FlightLogs() {
    const [flights, setFlights] = useState<FlightSummary[]>([]);
    const [activeFlight, setActiveFlight] = useState<FlightSummary | null>(null);
    const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
    const [packets, setPackets] = useState<TelemetryPacket[]>([]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [actionBusy, setActionBusy] = useState(false);

    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [showOnlyDet, setShowOnlyDet] = useState(false);

    const [showGeofenceModal, setShowGeofenceModal] = useState(false);
    const [geofenceSubmitting, setGeofenceSubmitting] = useState(false);

    const PACKETS_PER_PAGE = 25;

    const selectedFlight = useMemo(
        () => flights.find(f => f.id === selectedFlightId) ?? null,
        [flights, selectedFlightId],
    );

    const currentFlightId = selectedFlightId ?? activeFlight?.id ?? null;

    const refreshFlights = useCallback(async () => {
        setError(false);
        const [status, list] = await Promise.all([fetchFlightStatus(), fetchFlights()]);
        setActiveFlight(status);
        setFlights(list);

        if (!selectedFlightId) {
            if (status) {
                setSelectedFlightId(status.id);
            } else if (list.length > 0) {
                setSelectedFlightId(list[0].id);
            }
        } else {
            const stillExists = list.some(f => f.id === selectedFlightId);
            if (!stillExists) {
                if (status) setSelectedFlightId(status.id);
                else if (list.length > 0) setSelectedFlightId(list[0].id);
                else setSelectedFlightId(null);
            }
        }
    }, [selectedFlightId]);

    const loadPackets = useCallback(async (withLoading: boolean) => {
        if (!currentFlightId) {
            setPackets([]);
            if (withLoading) setLoading(false);
            return;
        }

        if (withLoading) setLoading(true);
        setError(false);
        const result = await fetchFlightPackets(currentFlightId);
        if (!result.flight && currentFlightId) {
            setError(true);
            setPackets([]);
        } else {
            setPackets(result.packets);
            if (result.flight) {
                setFlights(prev =>
                    prev.map(f => f.id === result.flight!.id ? result.flight! : f)
                );
                if (!result.flight.ended_at) {
                    setActiveFlight(result.flight);
                }
            }
        }
        if (withLoading) setLoading(false);
    }, [currentFlightId]);

    useEffect(() => {
        void (async () => {
            setLoading(true);
            await refreshFlights();
            setLoading(false);
        })();
    }, [refreshFlights]);

    useEffect(() => {
        void loadPackets(true);
    }, [loadPackets]);

    useEffect(() => {
        const interval = setInterval(() => {
            void refreshFlights();
            void loadPackets(false);
        }, 1000);

        return () => clearInterval(interval);
    }, [loadPackets, refreshFlights]);

    useEffect(() => {
        setCurrentPage(1);
    }, [search, showOnlyDet, currentFlightId]);

    const handleStartFlight = async () => {
        setShowGeofenceModal(true);
    };

    const handleGeofenceConfirm = async (geofence: GeofenceInput) => {
        setGeofenceSubmitting(true);
        
        // Send geofence command first
        const geofenceResult = await sendGeofence(
            geofence.latitude,
            geofence.longitude,
            geofence.radius,
            geofence.maxAltitude,
        );

        if (!geofenceResult.ok) {
            // TODO: show error to user, but don't proceed with flight start
            console.error('Geofence command failed:', geofenceResult.message);
            setShowGeofenceModal(false);
            setGeofenceSubmitting(false);
            alert(`Geofence failed: ${geofenceResult.message}`);
            return;
        }

        // Then start the flight
        setActionBusy(true);
        const flight = await startFlight();
        await refreshFlights();
        if (flight) {
            setSelectedFlightId(flight.id);
            await loadPackets(true);
        }
        setActionBusy(false);
        setShowGeofenceModal(false);
        setGeofenceSubmitting(false);
    };

    const handleGeofenceCancel = () => {
        setShowGeofenceModal(false);
    };

    const handleEndFlight = async () => {
        setActionBusy(true);
        const ended = await endFlight();
        await refreshFlights();
        if (ended) {
            setSelectedFlightId(ended.id);
            await loadPackets(true);
        }
        setActionBusy(false);
    };

    const filtered = useMemo(() => {
        let result = packets;
        if (showOnlyDet) {
            result = result.filter(p => p.det);
        }
        const q = search.toLowerCase();
        if (q) {
            result = result.filter(p =>
                p.latitude.toFixed(6).includes(q) ||
                p.longitude.toFixed(6).includes(q),
            );
        }
        return [...result].reverse();
    }, [packets, search, showOnlyDet]);

    const totalPages = Math.ceil(filtered.length / PACKETS_PER_PAGE);
    const paginatedPackets = useMemo(() => {
        const start = (currentPage - 1) * PACKETS_PER_PAGE;
        return filtered.slice(start, start + PACKETS_PER_PAGE);
    }, [filtered, currentPage]);

    const maxAltM = packets.length ? Math.max(...packets.map(p => p.altitude_m)) : null;
    const minRSSI = packets.length ? Math.min(...packets.map(p => p.rssi ?? 0)) : null;
    const lastPacket = packets[packets.length - 1] ?? null;

    const currentFlight = selectedFlight ?? activeFlight;
    const previousFlights = flights.filter(f => !activeFlight || f.id !== activeFlight.id);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 'var(--space-4)', maxWidth: 1400 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                    <div>
                        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semi)' }}>Flight Logs</h2>
                        <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
                            {currentFlight
                                ? `${currentFlight.name} · ${packets.length} packets`
                                : 'No selected flight'}
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                            className="btn btn-primary"
                            onClick={handleStartFlight}
                            disabled={actionBusy || !!activeFlight}
                        >
                            {activeFlight ? 'Flight Active' : 'Start Flight'}
                        </button>
                        <button
                            className="btn btn-danger"
                            onClick={handleEndFlight}
                            disabled={actionBusy || !activeFlight}
                        >
                            End Flight
                        </button>
                        <button
                            className="btn btn-secondary"
                            onClick={() => exportCSV(filtered, currentFlight?.name ?? 'flight')}
                            disabled={filtered.length === 0}
                        >
                            Export Selected Flight CSV
                        </button>
                    </div>
                </div>

                {!activeFlight && (
                    <div className="alert-banner alert-banner-info">
                        <span>ℹ️</span>
                        <span>Flight recording is idle. Click Start Flight to begin saving packets.</span>
                    </div>
                )}

                {activeFlight && (
                    <div className="alert-banner alert-banner-info">
                        <span>🟢</span>
                        <span>
                            Recording {activeFlight.name} since {fmtDateTime(activeFlight.started_at)}
                            {' · '}Duration {fmtDuration(activeFlight.started_at)}
                        </span>
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-4)' }}>
                    <SummaryCard label="Packets" value={`${packets.length}`} />
                    <SummaryCard
                        label="Flight Duration"
                        value={currentFlight ? fmtDuration(currentFlight.started_at, currentFlight.ended_at) : '--'}
                    />
                    <SummaryCard label="Peak Altitude" value={maxAltM != null ? maxAltM.toFixed(0) : '--'} unit="m" />
                    <SummaryCard label="Worst RSSI" value={minRSSI != null ? `${minRSSI}` : '--'} unit="dBm" />
                    <SummaryCard
                        label="Last Position"
                        value={lastPacket ? `${lastPacket.latitude.toFixed(4)}°` : '--'}
                        sub={lastPacket ? `${Math.abs(lastPacket.longitude).toFixed(4)}° W` : undefined}
                    />
                </div>

                {loading && (
                    <div className="alert-banner alert-banner-info">
                        <span>⏳</span><span>Loading flight packets…</span>
                    </div>
                )}
                {!loading && error && (
                    <div className="alert-banner alert-banner-warning">
                        <span>⚠️</span><span>Could not load selected flight packets.</span>
                    </div>
                )}
                {!loading && !error && packets.length === 0 && (
                    <div className="alert-banner alert-banner-info">
                        <span>📭</span><span>No packets in this flight yet.</span>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                        className="input"
                        type="text"
                        placeholder="Search by lat, lng…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ maxWidth: 300 }}
                    />
                    <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={showOnlyDet}
                            onChange={e => setShowOnlyDet(e.target.checked)}
                        />
                        <span className="text-sm">Deflation events only</span>
                    </label>
                    {filtered.length !== packets.length && (
                        <span className="text-xs text-muted">{filtered.length} of {packets.length} packets shown</span>
                    )}
                </div>

                <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                            <thead>
                                <tr style={{ background: 'var(--color-bg-panel)', borderBottom: '1px solid var(--color-border)' }}>
                                    {['Time', 'Alt (m)', 'Temp (°C)', 'Pressure', 'Tilt (°)', 'Stability', 'RSSI', 'SNR', 'SIV', 'Calc Gust', 'Lat', 'Lng'].map(h => (
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
                                {paginatedPackets.length === 0 && !loading ? (
                                    <tr>
                                        <td colSpan={12} style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                            No packets match the current filter.
                                        </td>
                                    </tr>
                                ) : paginatedPackets.map(p => {
                                    const key = p.timestamp;
                                    const isExpanded = expanded === key;
                                    const altM = p.altitude_m;
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
                                                    background: p.det ? 'rgba(220, 38, 38, 0.1)' : 'transparent',
                                                }}
                                                onMouseEnter={ev => (ev.currentTarget.style.background = p.det ? 'rgba(220, 38, 38, 0.15)' : 'var(--color-bg-card-hover)')}
                                                onMouseLeave={ev => (ev.currentTarget.style.background = p.det ? 'rgba(220, 38, 38, 0.1)' : 'transparent')}
                                            >
                                                <td style={{ padding: 'var(--space-2) var(--space-3)', whiteSpace: 'nowrap', color: p.det ? 'var(--color-danger)' : 'var(--color-text-secondary)', fontWeight: p.det ? 'bold' : 'normal' }}>
                                                    {fmtTime(p.timestamp)}
                                                    {p.det && <span style={{ marginLeft: 'var(--space-1)' }}>🚨</span>}
                                                </td>
                                                <td style={{ padding: 'var(--space-2) var(--space-3)', color: altM > 5800 ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>
                                                    {altM.toFixed(1)}
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
                                                <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                                    {p.satellites_in_view ?? '--'}
                                                </td>
                                                <td style={{ padding: 'var(--space-2) var(--space-3)', color: (p.calculated_wind_gust_mph ?? -1) > 40 ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                                                    {p.calculated_wind_gust_mph != null ? p.calculated_wind_gust_mph.toFixed(1) : '--'}
                                                </td>
                                                <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{p.latitude.toFixed(5)}</td>
                                                <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{p.longitude.toFixed(5)}</td>
                                            </tr>

                                            {isExpanded && (
                                                <tr key={`${key}-exp`} style={{ background: 'var(--color-bg-panel)', borderBottom: '1px solid var(--color-border)' }}>
                                                    <td colSpan={12} style={{ padding: 'var(--space-3) var(--space-4)' }}>
                                                        <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', fontSize: 'var(--text-xs)' }}>
                                                            {[
                                                                { k: 'Timestamp', v: p.timestamp },
                                                                { k: 'Latitude', v: `${p.latitude.toFixed(6)}°` },
                                                                { k: 'Longitude', v: `${p.longitude.toFixed(6)}°` },
                                                                { k: 'Altitude', v: `${p.altitude_m.toFixed(2)} m` },
                                                                { k: 'Temperature', v: `${p.temperature_c.toFixed(2)} °C` },
                                                                { k: 'Pressure', v: `${p.pressure_hpa.toFixed(2)} hPa` },
                                                                { k: 'Accel X', v: `${p.accel_x.toFixed(3)} m/s²` },
                                                                { k: 'Accel Y', v: `${p.accel_y.toFixed(3)} m/s²` },
                                                                { k: 'Accel Z', v: `${p.accel_z.toFixed(3)} m/s²` },
                                                                { k: 'Tilt', v: `${tilt.toFixed(1)}°` },
                                                                { k: 'Stability', v: p.stability_index != null ? p.stability_index.toFixed(2) : '—' },
                                                                { k: 'RSSI', v: p.rssi != null ? `${p.rssi} dBm` : '—' },
                                                                { k: 'SNR', v: p.snr != null ? `${p.snr.toFixed(1)} dB` : '—' },
                                                                { k: 'Satellites In View', v: p.satellites_in_view != null ? String(p.satellites_in_view) : '—' },
                                                                { k: 'Calc Wind Gust', v: p.calculated_wind_gust_mph != null ? `${p.calculated_wind_gust_mph.toFixed(1)} mph` : '—' },
                                                                { k: 'Detonation', v: p.det ? 'YES' : 'NO' },
                                                                {
                                                                    k: 'Det Reason',
                                                                    v: p.det
                                                                        ? (p.det_reason_text ?? (p.det_reason != null ? String(p.det_reason) : 'UNKNOWN'))
                                                                        : 'NONE',
                                                                },
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

                    <div style={{ padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                        <span className="text-xs text-muted">
                            {paginatedPackets.length} of {filtered.length} packets · Click any row to expand
                        </span>
                        {totalPages > 1 && (
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                                    disabled={currentPage === 1}
                                    style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)' }}
                                >
                                    ← Prev
                                </button>
                                <span className="text-xs text-muted">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                                    disabled={currentPage === totalPages}
                                    style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)' }}
                                >
                                    Next →
                                </button>
                            </div>
                        )}
                        <span className="text-xs text-muted font-mono">{currentFlight?.id ?? 'no-flight-selected'}</span>
                    </div>
                </div>
            </div>

            <aside className="card" style={{ height: 'fit-content', position: 'sticky', top: 'var(--space-4)' }}>
                {activeFlight && (
                    <>
                        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Current Flight</div>
                        <button
                            className={`btn ${selectedFlightId === activeFlight.id ? 'btn-primary' : 'btn-ghost'}`}
                            style={{
                                justifyContent: 'flex-start',
                                textAlign: 'left',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-start',
                                gap: 2,
                                width: '100%',
                                marginBottom: 'var(--space-4)',
                            }}
                            onClick={() => setSelectedFlightId(activeFlight.id)}
                        >
                            <span style={{ fontWeight: 600 }}>{activeFlight.name}</span>
                            <span className="text-xs" style={{ opacity: 0.85 }}>
                                {fmtDateTime(activeFlight.started_at)}
                            </span>
                            <span className="text-xs" style={{ opacity: 0.85 }}>
                                {activeFlight.packet_count} packets · {fmtDuration(activeFlight.started_at)}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                                LIVE
                            </span>
                        </button>
                    </>
                )}

                <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Previous Flights</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 600, overflowY: 'auto' }}>
                    {previousFlights.length === 0 ? (
                        <span className="text-sm text-secondary">No completed flights yet.</span>
                    ) : previousFlights.map(f => {
                        const selected = selectedFlightId === f.id;
                        return (
                            <button
                                key={f.id}
                                className={`btn ${selected ? 'btn-primary' : 'btn-ghost'}`}
                                style={{
                                    justifyContent: 'flex-start',
                                    textAlign: 'left',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'flex-start',
                                    gap: 2,
                                }}
                                onClick={() => setSelectedFlightId(f.id)}
                            >
                                <span style={{ fontWeight: 600 }}>{f.name}</span>
                                <span className="text-xs" style={{ opacity: 0.85 }}>
                                    {fmtDateTime(f.started_at)}
                                </span>
                                <span className="text-xs" style={{ opacity: 0.85 }}>
                                    {f.packet_count} packets · {fmtDuration(f.started_at, f.ended_at)}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </aside>

            <GeofenceModal
                isOpen={showGeofenceModal}
                onConfirm={handleGeofenceConfirm}
                onCancel={handleGeofenceCancel}
                isLoading={geofenceSubmitting}
            />
        </div>
    );
}
