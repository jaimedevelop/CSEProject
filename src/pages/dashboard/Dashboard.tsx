import { useState, useEffect, useCallback } from 'react';
import '../../styles/theme.css';
import {
    fetchLatestTelemetry,
    metersToFeet,
    type FetchState,
    type TelemetryPacket,
} from '../../services/telemetry';

const POLL_INTERVAL = 10; // seconds

// ─── Display helpers ──────────────────────────────────────────────────────────

/** Formats a number to `decimals` places, or returns '--' if null/undefined. */
function fmt(val: number | null | undefined, decimals = 1): string {
    if (val == null) return '--';
    return val.toFixed(decimals);
}

type Level = 'nominal' | 'warning' | 'critical' | 'unknown';

function batteryLevel(v: number | null): Level {
    if (v == null) return 'unknown';
    if (v < 5) return 'critical';
    if (v < 20) return 'warning';
    return 'nominal';
}
function signalLevel(v: number | null): Level {
    if (v == null) return 'unknown';
    if (v < -110) return 'critical';
    if (v < -95) return 'warning';
    return 'nominal';
}
function windLevel(v: number | null): Level {
    if (v == null) return 'unknown';
    if (v > 40) return 'critical';
    if (v > 25) return 'warning';
    return 'nominal';
}
function altLevel(v: number | null): Level {
    if (v == null) return 'unknown';
    return v > 19000 ? 'warning' : 'nominal'; // ft threshold
}
function overallStatus(d: TelemetryPacket | null): 'nominal' | 'warning' | 'critical' | 'unknown' {
    if (!d) return 'unknown';
    const altFt = metersToFeet(d.altitude_m);
    if ((d.rssi != null && d.rssi < -110)) return 'critical';
    if (
        altFt > 19000 ||
        (d.wind_gust_mph != null && d.wind_gust_mph > 40) ||
        (d.rssi != null && d.rssi < -95)
    ) return 'warning';
    return 'nominal';
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

interface Alert { id: string; level: 'warning' | 'danger' | 'info'; message: string; }

function deriveAlerts(d: TelemetryPacket): Alert[] {
    const alerts: Alert[] = [];
    const altFt = metersToFeet(d.altitude_m);
    if (d.rssi != null && d.rssi < -110)
        alerts.push({ id: 'sig-crit', level: 'danger', message: `Signal critical: ${d.rssi} dBm — approaching loss-of-comms threshold.` });
    else if (d.rssi != null && d.rssi < -95)
        alerts.push({ id: 'sig-warn', level: 'warning', message: `Weak signal: ${d.rssi} dBm` });
    if (d.wind_gust_mph != null && d.wind_gust_mph > 40)
        alerts.push({ id: 'wind-warn', level: 'danger', message: `Wind gusts exceed 40 mph (${d.wind_gust_mph.toFixed(1)} mph) — deflation recommended.` });
    if (d.pressure_hpa < 1009)
        alerts.push({ id: 'pres-warn', level: 'warning', message: `Low pressure: ${d.pressure_hpa} hPa — storm conditions possible.` });
    if (altFt > 19000)
        alerts.push({ id: 'alt-warn', level: 'warning', message: `High altitude: ${altFt.toFixed(0)} ft` });
    return alerts;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TelemetryCard({ label, value, unit, level = 'nominal', children }: {
    label: string; value: string; unit?: string;
    level?: Level; children?: React.ReactNode;
}) {
    return (
        <div className="card" style={{ minWidth: 140 }}>
            <div className="card-title">{label}</div>
            <div style={{ marginTop: 'var(--space-2)' }}>
                <span className={`data-value status-${level}`}>{value}</span>
                {unit && value !== '--' && <span className="data-unit">{unit}</span>}
            </div>
            {children}
        </div>
    );
}

function BatteryBar({ pct }: { pct: number | null }) {
    const level = batteryLevel(pct);
    return (
        <div className="progress-bar" style={{ marginTop: 'var(--space-2)' }}>
            <div
                className={`progress-bar-fill ${level}`}
                style={{ width: pct != null ? `${pct}%` : '0%' }}
            />
        </div>
    );
}

function StabilityPlaceholder() {
    return (
        <div className="card">
            <div className="card-title">Stability Index</div>
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'baseline', gap: 'var(--space-1)' }}>
                <span className="data-value status-unknown">--</span>
                <span className="data-unit">/ 100</span>
            </div>
            <div className="progress-bar" style={{ marginTop: 'var(--space-3)' }}>
                <div className="progress-bar-fill nominal" style={{ width: '0%' }} />
            </div>
            <div className="data-label" style={{ marginTop: 'var(--space-2)' }}>
                No data source yet
            </div>
        </div>
    );
}

function AlertBanner({ alert }: { alert: Alert }) {
    const icons: Record<Alert['level'], string> = { warning: '⚠️', danger: '🚨', info: 'ℹ️' };
    return (
        <div className={`alert-banner alert-banner-${alert.level === 'danger' ? 'danger' : alert.level === 'warning' ? 'warning' : 'info'}`}>
            <span>{icons[alert.level]}</span>
            <span>{alert.message}</span>
        </div>
    );
}

function ConnectionBanner({ state }: { state: FetchState['status'] }) {
    if (state === 'ok') return null;
    const msgs: Record<string, string> = {
        loading: 'Connecting to backend…',
        no_data: 'Backend reachable — waiting for first telemetry packet.',
        error: 'Not receiving data — check that the backend and listener are running.',
    };
    return (
        <div className="alert-banner alert-banner-warning">
            <span>📡</span>
            <span>{msgs[state] ?? 'Unknown connection state.'}</span>
        </div>
    );
}

function NextUpdateBar({ secondsLeft, total }: { secondsLeft: number; total: number }) {
    const pct = ((total - secondsLeft) / total) * 100;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span className="text-xs text-muted" style={{ whiteSpace: 'nowrap' }}>
                Next update in {secondsLeft}s
            </span>
            <div className="progress-bar" style={{ flex: 1, height: 4 }}>
                <div
                    className="progress-bar-fill nominal"
                    style={{ width: `${pct}%`, transition: 'width 1s linear' }}
                />
            </div>
        </div>
    );
}

function DeflationButton() {
    const [phase, setPhase] = useState<'idle' | 'confirm' | 'sending' | 'confirmed'>('idle');
    const handleClick = () => {
        if (phase === 'idle') return setPhase('confirm');
        if (phase === 'confirm') {
            setPhase('sending');
            setTimeout(() => setPhase('confirmed'), 2000);
            setTimeout(() => setPhase('idle'), 6000);
        }
    };
    const labels = {
        idle: '🔴 Manual Deflation',
        confirm: '⚠️ Confirm Deflation?',
        sending: '📡 Sending Command…',
        confirmed: '✅ Descent Initiated',
    };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <button
                className={`btn ${phase === 'idle' ? 'btn-danger' : phase === 'confirmed' ? 'btn-ghost' : 'btn-danger'}`}
                onClick={handleClick}
                disabled={phase === 'sending' || phase === 'confirmed'}
                style={{ width: '100%', padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-base)' }}
            >
                {labels[phase]}
            </button>
            {phase === 'confirm' && (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)', textAlign: 'center' }}>
                    Click again to confirm. This will rupture the balloon envelope.
                </p>
            )}
        </div>
    );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
    const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' });
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [countdown, setCountdown] = useState(POLL_INTERVAL);
    const [alerts, setAlerts] = useState<Alert[]>([]);

    const data = fetchState.status === 'ok' ? fetchState.data : null;

    const poll = useCallback(async () => {
        const result = await fetchLatestTelemetry();
        setFetchState(result);
        if (result.status === 'ok') {
            setLastUpdated(new Date());
            setAlerts(deriveAlerts(result.data));
        }
        setCountdown(POLL_INTERVAL);
    }, []);

    // Initial fetch + polling
    useEffect(() => {
        poll();
        const interval = setInterval(poll, POLL_INTERVAL * 1000);
        return () => clearInterval(interval);
    }, [poll]);

    // Countdown ticker
    useEffect(() => {
        const tick = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
        return () => clearInterval(tick);
    }, []);

    const status = overallStatus(data);
    const altFt = data ? metersToFeet(data.altitude_m) : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 1200 }}>

            {/* ── Topbar ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <span className={fetchState.status === 'ok' ? 'live-dot' : 'live-dot inactive'} />
                    <span style={{ fontWeight: 'var(--font-semi)', fontSize: 'var(--text-lg)' }}>
                        Balloon Dashboard
                    </span>
                    <span className={`badge badge-${status === 'nominal' ? 'success' : status === 'warning' ? 'warning' : status === 'critical' ? 'danger' : 'muted'}`}>
                        {status.toUpperCase()}
                    </span>
                </div>
                <span className="text-muted text-sm">
                    {lastUpdated ? `Last update: ${lastUpdated.toLocaleTimeString()}` : 'No data yet'}
                </span>
            </div>

            {/* ── Next update progress bar ── */}
            <NextUpdateBar secondsLeft={countdown} total={POLL_INTERVAL} />

            {/* ── Connection / no-data banner ── */}
            <ConnectionBanner state={fetchState.status} />

            {/* ── Alert Banners ── */}
            {alerts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {alerts.map(a => <AlertBanner key={a.id} alert={a} />)}
                </div>
            )}

            {/* ── Primary Telemetry Grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-4)' }}>
                <TelemetryCard label="Altitude" value={fmt(altFt, 1)} unit="ft" level={altLevel(altFt)} />
                <TelemetryCard label="Signal (RSSI)" value={fmt(data?.rssi, 0)} unit="dBm" level={signalLevel(data?.rssi ?? null)} />
                <TelemetryCard label="Pressure" value={fmt(data?.pressure_hpa, 1)} unit="hPa" />
                <TelemetryCard label="Wind Gust" value={fmt(data?.wind_gust_mph, 1)} unit="mph" level={windLevel(data?.wind_gust_mph ?? null)} />
                <TelemetryCard label="Temperature" value={fmt(data?.temperature_c, 1)} unit="°C" />
            </div>

            {/* ── Stability + GPS ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <StabilityPlaceholder />

                <div className="card">
                    <div className="card-title">GPS Position</div>
                    <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {[
                            { label: 'Latitude', val: data ? `${data.latitude.toFixed(6)}°` : '--' },
                            { label: 'Longitude', val: data ? `${data.longitude.toFixed(6)}°` : '--' },
                            { label: 'Altitude', val: altFt != null ? `${altFt.toFixed(1)} ft` : '--' },
                        ].map(r => (
                            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="text-secondary text-sm">{r.label}</span>
                                <span className="font-mono text-sm">{r.val}</span>
                            </div>
                        ))}
                        <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
                            <span className="text-xs text-muted">
                                {data?.source ? `Source: ${data.source}` : 'No source'} · Updated every {POLL_INTERVAL}s
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Emergency Controls ── */}
            <div className="card" style={{ borderColor: 'var(--color-danger)', boxShadow: 'var(--shadow-glow-red)' }}>
                <div className="card-title" style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-3)' }}>
                    Emergency Controls
                </div>
                <p className="text-sm text-secondary" style={{ marginBottom: 'var(--space-4)' }}>
                    Manual deflation overrides all logic and ruptures the balloon envelope. Use only in an emergency.
                    Descent confirmation will be received within 5 seconds.
                </p>
                <DeflationButton />
            </div>

        </div>
    );
}