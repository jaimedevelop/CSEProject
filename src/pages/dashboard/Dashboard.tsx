import { useState, useEffect } from 'react';
import '../../styles/theme.css';

// ─── Mock Types ───────────────────────────────────────────────────────────────

interface Telemetry {
    latitude: number;
    longitude: number;
    altitude: number;       // feet
    battery: number;       // percent 0–100
    signal: number;       // dBm (negative)
    pressure: number;       // millibars
    windGust: number;       // mph
    stabilityIndex: number;       // 0–100 (higher = more stable)
    timestamp: Date;
    status: 'nominal' | 'warning' | 'critical';
}

interface Alert {
    id: string;
    level: 'warning' | 'danger' | 'info';
    message: string;
}

// ─── Mock Data Helpers ────────────────────────────────────────────────────────

const BASE: Telemetry = {
    latitude: 33.4484,
    longitude: -112.0740,
    altitude: 18.2,
    battery: 74,
    signal: -88,
    pressure: 1013.2,
    windGust: 12,
    stabilityIndex: 82,
    timestamp: new Date(),
    status: 'nominal',
};

function jitter(val: number, range: number) {
    return parseFloat((val + (Math.random() - 0.5) * range).toFixed(2));
}

function generateTelemetry(prev: Telemetry): Telemetry {
    const battery = parseFloat(Math.max(0, prev.battery - 0.05).toFixed(1));
    const signal = jitter(prev.signal, 4);
    const windGust = Math.max(0, jitter(prev.windGust, 5));
    const stability = Math.min(100, Math.max(0, jitter(prev.stabilityIndex, 6)));
    const pressure = jitter(prev.pressure, 0.3);

    let status: Telemetry['status'] = 'nominal';
    if (battery < 20 || signal < -110 || windGust > 40) status = 'warning';
    if (battery < 5) status = 'critical';

    return {
        ...prev,
        battery,
        signal,
        windGust,
        stabilityIndex: stability,
        pressure,
        altitude: jitter(prev.altitude, 0.5),
        timestamp: new Date(),
        status,
    };
}

function deriveAlerts(t: Telemetry): Alert[] {
    const alerts: Alert[] = [];
    if (t.battery < 5) alerts.push({ id: 'bat-crit', level: 'danger', message: `CRITICAL: Battery at ${t.battery}% — auto-deflation imminent.` });
    else if (t.battery < 20) alerts.push({ id: 'bat-warn', level: 'warning', message: `Battery low: ${t.battery}% — consider landing soon.` });
    if (t.signal < -110) alerts.push({ id: 'sig-warn', level: 'warning', message: `Weak signal: ${t.signal} dBm — approaching loss-of-comms threshold.` });
    if (t.windGust > 40) alerts.push({ id: 'wind-warn', level: 'danger', message: `Wind gusts exceed 40 mph (${t.windGust.toFixed(1)} mph) — deflation recommended.` });
    if (t.pressure < 1009) alerts.push({ id: 'pres-warn', level: 'warning', message: `Low pressure: ${t.pressure} mb — storm conditions possible.` });
    return alerts;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TelemetryCard({
    label, value, unit, level = 'nominal', children
}: {
    label: string; value: string | number; unit?: string;
    level?: 'nominal' | 'warning' | 'critical'; children?: React.ReactNode;
}) {
    return (
        <div className="card" style={{ minWidth: 140 }}>
            <div className="card-title">{label}</div>
            <div style={{ marginTop: 'var(--space-2)' }}>
                <span className={`data-value status-${level}`}>{value}</span>
                {unit && <span className="data-unit">{unit}</span>}
            </div>
            {children}
        </div>
    );
}

function BatteryBar({ pct }: { pct: number }) {
    const level = pct < 5 ? 'critical' : pct < 20 ? 'warning' : 'nominal';
    return (
        <div className="progress-bar" style={{ marginTop: 'var(--space-2)' }}>
            <div className={`progress-bar-fill ${level}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

function StabilityMeter({ value }: { value: number }) {
    const level = value < 30 ? 'critical' : value < 60 ? 'warning' : 'nominal';
    return (
        <div className="card">
            <div className="card-title">Stability Index</div>
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'baseline', gap: 'var(--space-1)' }}>
                <span className={`data-value status-${level}`}>{value.toFixed(0)}</span>
                <span className="data-unit">/ 100</span>
            </div>
            <div className="progress-bar" style={{ marginTop: 'var(--space-3)' }}>
                <div className={`progress-bar-fill ${level}`} style={{ width: `${value}%` }} />
            </div>
            <div className="data-label" style={{ marginTop: 'var(--space-2)' }}>
                {value >= 60 ? 'Stable' : value >= 30 ? 'Moderate turbulence' : 'High turbulence'}
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
    const [telemetry, setTelemetry] = useState<Telemetry>(BASE);
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [elapsed, setElapsed] = useState(0); // seconds since last update

    // Telemetry updates every 10s per requirements
    useEffect(() => {
        const interval = setInterval(() => {
            setTelemetry(prev => {
                const next = generateTelemetry(prev);
                setAlerts(deriveAlerts(next));
                setElapsed(0);
                return next;
            });
        }, 10_000);
        return () => clearInterval(interval);
    }, []);

    // Elapsed counter (for "last updated X seconds ago")
    useEffect(() => {
        const tick = setInterval(() => setElapsed(e => e + 1), 1000);
        return () => clearInterval(tick);
    }, []);

    const batLevel = telemetry.battery < 5 ? 'critical' : telemetry.battery < 20 ? 'warning' : 'nominal';
    const sigLevel = telemetry.signal < -110 ? 'critical' : telemetry.signal < -95 ? 'warning' : 'nominal';
    const windLevel = telemetry.windGust > 40 ? 'critical' : telemetry.windGust > 25 ? 'warning' : 'nominal';
    const altLevel = telemetry.altitude > 19 ? 'warning' : 'nominal';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 1200 }}>

            {/* ── Topbar Status ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <span className="live-dot" />
                    <span style={{ fontWeight: 'var(--font-semi)', fontSize: 'var(--text-lg)' }}>
                        Balloon Dashboard
                    </span>
                    <span className={`badge badge-${telemetry.status === 'nominal' ? 'success' : telemetry.status === 'warning' ? 'warning' : 'danger'}`}>
                        {telemetry.status.toUpperCase()}
                    </span>
                </div>
                <span className="text-muted text-sm">
                    Last update: {elapsed}s ago · {telemetry.timestamp.toLocaleTimeString()}
                </span>
            </div>

            {/* ── Alert Banners ── */}
            {alerts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {alerts.map(a => <AlertBanner key={a.id} alert={a} />)}
                </div>
            )}

            {/* ── Primary Telemetry Grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-4)' }}>
                <TelemetryCard label="Altitude" value={telemetry.altitude.toFixed(1)} unit="ft" level={altLevel} />
                <TelemetryCard label="Battery" value={telemetry.battery.toFixed(1)} unit="%" level={batLevel}>
                    <BatteryBar pct={telemetry.battery} />
                </TelemetryCard>
                <TelemetryCard label="Signal" value={telemetry.signal.toFixed(0)} unit="dBm" level={sigLevel} />
                <TelemetryCard label="Pressure" value={telemetry.pressure.toFixed(1)} unit="mb" />
                <TelemetryCard label="Wind Gust" value={telemetry.windGust.toFixed(1)} unit="mph" level={windLevel} />
            </div>

            {/* ── Stability Index + Position ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <StabilityMeter value={telemetry.stabilityIndex} />

                <div className="card">
                    <div className="card-title">GPS Position</div>
                    <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {[
                            { label: 'Latitude', val: `${telemetry.latitude.toFixed(6)}°` },
                            { label: 'Longitude', val: `${telemetry.longitude.toFixed(6)}°` },
                            { label: 'Altitude', val: `${telemetry.altitude.toFixed(1)} ft` },
                        ].map(r => (
                            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="text-secondary text-sm">{r.label}</span>
                                <span className="font-mono text-sm">{r.val}</span>
                            </div>
                        ))}
                        <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
                            <span className="text-xs text-muted">Accuracy: ±20 ft · Updated every 10s</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Manual Deflation ── */}
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