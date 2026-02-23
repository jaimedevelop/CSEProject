import { useState, useMemo } from 'react';
import '../../styles/theme.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type TriggerType = 'auto-geofence' | 'auto-altitude' | 'auto-battery' | 'manual' | 'auto-signal' | null;
type EventType = 'telemetry' | 'alert' | 'deflation' | 'landing';

interface FlightLogEntry {
    id: string;
    timestamp: Date;
    type: EventType;
    latitude: number;
    longitude: number;
    altitude: number;   // ft
    battery: number;   // %
    signal: number;   // dBm
    pressure: number;   // mb
    windGust: number;   // mph
    stabilityIndex: number;   // 0–100
    trigger: TriggerType;
    note: string;
}

// ─── Mock Flight Log Data ─────────────────────────────────────────────────────

function makeEntry(
    id: string, minutesAgo: number, type: EventType,
    overrides: Partial<FlightLogEntry> = {}
): FlightLogEntry {
    const ts = new Date(Date.now() - minutesAgo * 60_000);
    return {
        id,
        timestamp: ts,
        type,
        latitude: 33.4484 + (Math.random() - 0.5) * 0.001,
        longitude: -112.074 + (Math.random() - 0.5) * 0.001,
        altitude: 12 + Math.random() * 6,
        battery: 90 - minutesAgo * 0.08,
        signal: -88 - Math.random() * 10,
        pressure: 1013 - minutesAgo * 0.01,
        windGust: 8 + Math.random() * 10,
        stabilityIndex: 75 + (Math.random() - 0.5) * 20,
        trigger: null,
        note: '',
        ...overrides,
    };
}

const MOCK_LOG: FlightLogEntry[] = [
    makeEntry('e01', 85, 'telemetry', { altitude: 0, battery: 100, note: 'Launch sequence initiated' }),
    makeEntry('e02', 84, 'telemetry', { altitude: 8.2 }),
    makeEntry('e03', 83, 'telemetry', { altitude: 15.4 }),
    makeEntry('e04', 82, 'telemetry', { altitude: 18.1 }),
    makeEntry('e05', 70, 'telemetry', {}),
    makeEntry('e06', 60, 'alert', { signal: -106, note: 'Signal below −100 dBm — monitoring' }),
    makeEntry('e07', 55, 'telemetry', {}),
    makeEntry('e08', 45, 'alert', { windGust: 38, note: 'Wind gust spike detected: 38 mph' }),
    makeEntry('e09', 40, 'telemetry', {}),
    makeEntry('e10', 35, 'alert', { battery: 22, note: 'Battery warning: 22% — below 20% threshold' }),
    makeEntry('e11', 30, 'telemetry', {}),
    makeEntry('e12', 20, 'alert', { battery: 18, pressure: 1006, note: 'Pressure drop + low battery' }),
    makeEntry('e13', 15, 'deflation', { battery: 14, trigger: 'manual', note: 'Operator initiated manual deflation' }),
    makeEntry('e14', 14, 'telemetry', { altitude: 12.0, note: 'Descent confirmed' }),
    makeEntry('e15', 13, 'telemetry', { altitude: 6.5 }),
    makeEntry('e16', 12, 'telemetry', { altitude: 1.2 }),
    makeEntry('e17', 11, 'landing', { altitude: 0, battery: 13, note: 'Landing detected · Buzzer + strobe active', trigger: null }),
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(d: Date) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(d: Date) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function triggerLabel(t: TriggerType): string {
    if (!t) return '—';
    return {
        'auto-geofence': 'Auto · Geofence',
        'auto-altitude': 'Auto · Altitude',
        'auto-battery': 'Auto · Battery',
        'auto-signal': 'Auto · Signal',
        'manual': 'Manual',
    }[t];
}

function exportCSV(entries: FlightLogEntry[]) {
    const headers = [
        'timestamp', 'type', 'latitude', 'longitude', 'altitude_ft',
        'battery_pct', 'signal_dbm', 'pressure_mb', 'wind_gust_mph',
        'stability_index', 'trigger', 'note',
    ];
    const rows = entries.map(e => [
        e.timestamp.toISOString(),
        e.type,
        e.latitude.toFixed(6),
        e.longitude.toFixed(6),
        e.altitude.toFixed(2),
        e.battery.toFixed(1),
        e.signal.toFixed(1),
        e.pressure.toFixed(2),
        e.windGust.toFixed(1),
        e.stabilityIndex.toFixed(1),
        e.trigger ?? '',
        `"${e.note}"`,
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

// ─── Row badge ────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: EventType }) {
    const map: Record<EventType, { cls: string; label: string }> = {
        telemetry: { cls: 'badge-info', label: 'TELEMETRY' },
        alert: { cls: 'badge-warning', label: 'ALERT' },
        deflation: { cls: 'badge-danger', label: 'DEFLATION' },
        landing: { cls: 'badge-success', label: 'LANDING' },
    };
    const { cls, label } = map[type];
    return <span className={`badge ${cls}`}>{label}</span>;
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

// ─── FlightLogs ──────────────────────────────────────────────────────────────

export default function FlightLogs() {
    const [filter, setFilter] = useState<'all' | EventType>('all');
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);

    const filtered = useMemo(() => {
        return MOCK_LOG.filter(e => {
            const matchType = filter === 'all' || e.type === filter;
            const q = search.toLowerCase();
            const matchSearch = !q || e.note.toLowerCase().includes(q) || e.type.includes(q) || (e.trigger ?? '').includes(q);
            return matchType && matchSearch;
        });
    }, [filter, search]);

    const landingEntry = MOCK_LOG.find(e => e.type === 'landing');
    const firstEntry = MOCK_LOG[0];
    const alertCount = MOCK_LOG.filter(e => e.type === 'alert').length;
    const flightMinutes = Math.round((MOCK_LOG[MOCK_LOG.length - 1].timestamp.getTime() - firstEntry.timestamp.getTime()) / 60_000);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 1100 }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semi)' }}>Flight Logs</h2>
                    <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
                        {fmtDate(firstEntry.timestamp)} · {MOCK_LOG.length} entries · Mock session data
                    </p>
                </div>
                <button className="btn btn-primary" onClick={() => exportCSV(filtered)}>
                    ⬇ Export CSV
                </button>
            </div>

            {/* Summary row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-4)' }}>
                <SummaryCard label="Flight Duration" value={`${flightMinutes}`} unit="min" />
                <SummaryCard label="Total Entries" value={`${MOCK_LOG.length}`} />
                <SummaryCard label="Alerts Logged" value={`${alertCount}`} />
                <SummaryCard
                    label="Landing Coords"
                    value={landingEntry ? `${landingEntry.latitude.toFixed(4)}°` : '—'}
                    sub={landingEntry ? `${Math.abs(landingEntry.longitude).toFixed(4)}° W` : undefined}
                />
                <SummaryCard
                    label="Final Battery"
                    value={`${MOCK_LOG[MOCK_LOG.length - 1].battery.toFixed(0)}`}
                    unit="%"
                />
            </div>

            {/* Landing Event highlight */}
            {landingEntry && (
                <div className="alert-banner" style={{
                    background: 'var(--color-success-bg)', color: 'var(--color-success)',
                    borderColor: 'var(--color-success)', borderLeftWidth: 4,
                }}>
                    <span>🛬</span>
                    <div>
                        <strong>Landing Event Recorded</strong> · {fmtTime(landingEntry.timestamp)}
                        <span className="font-mono" style={{ marginLeft: 'var(--space-3)', fontSize: 'var(--text-xs)' }}>
                            {landingEntry.latitude.toFixed(6)}°, {landingEntry.longitude.toFixed(6)}°
                        </span>
                        <span className="text-xs" style={{ marginLeft: 'var(--space-3)', opacity: 0.8 }}>
                            Accuracy: ±20 ft · Buzzer & strobe active
                        </span>
                    </div>
                </div>
            )}

            {/* Filters + Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    {(['all', 'telemetry', 'alert', 'deflation', 'landing'] as const).map(f => (
                        <button
                            key={f}
                            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setFilter(f)}
                        >
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                    ))}
                </div>
                <input
                    className="input"
                    type="text"
                    placeholder="Search notes or triggers…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ maxWidth: 240, marginLeft: 'auto' }}
                />
            </div>

            {/* Log Table */}
            <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg-panel)', borderBottom: '1px solid var(--color-border)' }}>
                                {['Time', 'Type', 'Alt (ft)', 'Bat (%)', 'Signal', 'Pressure', 'Wind', 'Stability', 'Trigger', 'Note'].map(h => (
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
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={10} style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                        No log entries match the current filter.
                                    </td>
                                </tr>
                            ) : filtered.map(e => {
                                const isExpanded = expanded === e.id;
                                const rowBg = e.type === 'deflation' ? 'rgba(239,68,68,0.07)'
                                    : e.type === 'landing' ? 'rgba(34,197,94,0.07)'
                                        : e.type === 'alert' ? 'rgba(245,158,11,0.05)'
                                            : 'transparent';
                                return (
                                    <>
                                        <tr
                                            key={e.id}
                                            onClick={() => setExpanded(isExpanded ? null : e.id)}
                                            style={{
                                                borderBottom: '1px solid var(--color-border)',
                                                background: rowBg,
                                                cursor: 'pointer',
                                                transition: 'background var(--transition-fast)',
                                            }}
                                            onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--color-bg-card-hover)')}
                                            onMouseLeave={ev => (ev.currentTarget.style.background = rowBg)}
                                        >
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>
                                                {fmtTime(e.timestamp)}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                                <TypeBadge type={e.type} />
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: e.altitude > 19 ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>
                                                {e.altitude.toFixed(1)}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: e.battery < 20 ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>
                                                {e.battery.toFixed(1)}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: e.signal < -110 ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                                                {e.signal.toFixed(0)}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{e.pressure.toFixed(1)}</td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: e.windGust > 40 ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                                                {e.windGust.toFixed(1)}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{e.stabilityIndex.toFixed(0)}</td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: e.trigger === 'manual' ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                                                {triggerLabel(e.trigger)}
                                            </td>
                                            <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {e.note || '—'}
                                            </td>
                                        </tr>

                                        {/* Expanded row with full GPS coords */}
                                        {isExpanded && (
                                            <tr key={`${e.id}-exp`} style={{ background: 'var(--color-bg-panel)', borderBottom: '1px solid var(--color-border)' }}>
                                                <td colSpan={10} style={{ padding: 'var(--space-3) var(--space-4)' }}>
                                                    <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', fontSize: 'var(--text-xs)' }}>
                                                        {[
                                                            { k: 'Timestamp', v: e.timestamp.toISOString() },
                                                            { k: 'Latitude', v: `${e.latitude.toFixed(6)}°` },
                                                            { k: 'Longitude', v: `${e.longitude.toFixed(6)}°` },
                                                            { k: 'Altitude', v: `${e.altitude.toFixed(2)} ft` },
                                                            { k: 'Battery', v: `${e.battery.toFixed(1)}%` },
                                                            { k: 'Signal', v: `${e.signal.toFixed(1)} dBm` },
                                                            { k: 'Pressure', v: `${e.pressure.toFixed(2)} mb` },
                                                            { k: 'Wind Gust', v: `${e.windGust.toFixed(1)} mph` },
                                                            { k: 'Stability', v: `${e.stabilityIndex.toFixed(1)} / 100` },
                                                            { k: 'Trigger', v: triggerLabel(e.trigger) },
                                                            { k: 'Note', v: e.note || '—' },
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
                        Showing {filtered.length} of {MOCK_LOG.length} entries · Click any row to expand
                    </span>
                    <span className="text-xs text-muted font-mono">
                        Session: {fmtDate(firstEntry.timestamp)}
                    </span>
                </div>
            </div>
        </div>
    );
}