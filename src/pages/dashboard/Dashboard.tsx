import { useState, useEffect, useCallback } from 'react';
import '../../styles/theme.css';
import {
    fetchLatestTelemetry,
    metersToFeet,
    triggerManualDeflation,
    tiltAngle,
    type FetchState,
    type TelemetryPacket,
} from '../../services/telemetry';

const POLL_INTERVAL = 1; // seconds — set to match packet cadence

// ─── Display helpers ──────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, decimals = 1): string {
    if (val == null) return '--';
    return val.toFixed(decimals);
}

type Level = 'nominal' | 'warning' | 'critical' | 'unknown';

function signalLevel(v: number | null): Level {
    if (v == null) return 'unknown';
    if (v < -110) return 'critical';
    if (v < -95) return 'warning';
    return 'nominal';
}

function snrLevel(v: number | null): Level {
    if (v == null) return 'unknown';
    if (v < 0) return 'critical';
    if (v < 5) return 'warning';
    return 'nominal';
}

function altLevel(v: number | null): Level {
    if (v == null) return 'unknown';
    return v > 19000 ? 'warning' : 'nominal'; // ft
}

function tiltLevel(deg: number | null): Level {
    if (deg == null) return 'unknown';
    if (deg > 45) return 'critical';
    if (deg > 20) return 'warning';
    return 'nominal';
}

function overallStatus(d: TelemetryPacket | null): 'nominal' | 'warning' | 'critical' | 'unknown' {
    if (!d) return 'unknown';
    const altFt = metersToFeet(d.altitude_m);
    const tilt = tiltAngle(d.accel_x, d.accel_y, d.accel_z);
    if (d.rssi != null && d.rssi < -110) return 'critical';
    if (
        altFt > 19000 ||
        tilt > 45 ||
        (d.rssi != null && d.rssi < -95) ||
        (d.snr != null && d.snr < 0)
    ) return 'warning';
    return 'nominal';
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

interface Alert { id: string; level: 'warning' | 'danger' | 'info'; message: string; }

function detReasonLabel(packet: TelemetryPacket): string {
    if (packet.det_reason_text) return packet.det_reason_text;
    const reasons: Record<number, string> = {
        0: 'NONE',
        1: 'MANUAL_POP',
        2: 'LOW_BATTERY',
        3: 'GEOFENCE_EXIT',
        4: 'ALTITUDE_DROP',
    };
    if (packet.det_reason == null) return 'UNKNOWN';
    return reasons[packet.det_reason] ?? `UNKNOWN_${packet.det_reason}`;
}

function deriveAlerts(d: TelemetryPacket): Alert[] {
    const alerts: Alert[] = [];
    const altFt = metersToFeet(d.altitude_m);
    const tilt = tiltAngle(d.accel_x, d.accel_y, d.accel_z);

    if (d.det) {
        alerts.push({
            id: 'det-fired',
            level: 'danger',
            message: `Detonation reported: ${detReasonLabel(d)}`,
        });
    }

    if (d.rssi != null && d.rssi < -110)
        alerts.push({ id: 'sig-crit', level: 'danger', message: `Signal critical: ${d.rssi} dBm — approaching loss-of-comms threshold.` });
    else if (d.rssi != null && d.rssi < -95)
        alerts.push({ id: 'sig-warn', level: 'warning', message: `Weak signal: ${d.rssi} dBm` });

    if (d.snr != null && d.snr < 0)
        alerts.push({ id: 'snr-warn', level: 'warning', message: `Negative SNR: ${d.snr} dB — packet loss likely.` });

    if (d.pressure_hpa < 890)
        alerts.push({ id: 'pres-warn', level: 'warning', message: `Low pressure: ${d.pressure_hpa.toFixed(1)} hPa — high altitude or storm conditions.` });

    if (altFt > 19000)
        alerts.push({ id: 'alt-warn', level: 'warning', message: `High altitude: ${altFt.toFixed(0)} ft` });

    if (tilt > 45)
        alerts.push({ id: 'tilt-crit', level: 'danger', message: `Extreme tilt: ${tilt.toFixed(1)}° — payload may be tumbling.` });
    else if (tilt > 20)
        alerts.push({ id: 'tilt-warn', level: 'warning', message: `Elevated tilt: ${tilt.toFixed(1)}°` });

    if (d.wind_gust_mph != null && d.wind_gust_mph > 40)
        alerts.push({ id: 'wind-warn', level: 'danger', message: `Wind gusts exceed 40 mph (${d.wind_gust_mph.toFixed(1)} mph) — deflation recommended.` });

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

function AccelCard({ ax, ay, az }: { ax: number | null; ay: number | null; az: number | null }) {
    const tilt = (ax != null && ay != null && az != null) ? tiltAngle(ax, ay, az) : null;
    const level = tiltLevel(tilt);
    return (
        <div className="card" style={{ minWidth: 140 }}>
            <div className="card-title">Orientation</div>
            <div style={{ marginTop: 'var(--space-2)' }}>
                <span className={`data-value status-${level}`}>{fmt(tilt, 1)}</span>
                {tilt != null && <span className="data-unit">° tilt</span>}
            </div>
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[['X', ax], ['Y', ay], ['Z', az]].map(([axis, val]) => (
                    <div key={String(axis)} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="text-xs text-muted">Accel {axis}</span>
                        <span className="font-mono text-xs">{fmt(val as number | null, 2)} m/s²</span>
                    </div>
                ))}
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

function DeflationButton() {
    const [phase, setPhase] = useState<'idle' | 'confirm' | 'sending' | 'confirmed' | 'error'>('idle');
    const [statusMsg, setStatusMsg] = useState<string>('');

    const handleClick = async () => {
        if (phase === 'idle') return setPhase('confirm');
        if (phase === 'confirm') {
            setPhase('sending');
            const result = await triggerManualDeflation();
            if (result.ok) {
                setStatusMsg(result.message);
                setPhase('confirmed');
            } else {
                setStatusMsg(result.message);
                setPhase('error');
            }
            setTimeout(() => {
                setStatusMsg('');
                setPhase('idle');
            }, 6000);
        }
    };
    const labels = {
        idle: '🔴 Manual Deflation',
        confirm: '⚠️ Confirm Deflation?',
        sending: '📡 Sending Command…',
        confirmed: '✅ Descent Initiated',
        error: '❌ Command Failed',
    };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <button
                className={`btn ${phase === 'confirmed' ? 'btn-ghost' : 'btn-danger'}`}
                onClick={handleClick}
                disabled={phase === 'sending'}
                style={{ width: '100%', padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-base)' }}
            >
                {labels[phase]}
            </button>
            {phase === 'confirm' && (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)', textAlign: 'center' }}>
                    Click again to confirm. This will rupture the balloon envelope.
                </p>
            )}
            {statusMsg && (
                <p
                    style={{
                        fontSize: 'var(--text-xs)',
                        color: phase === 'error' ? 'var(--color-danger)' : 'var(--color-success)',
                        textAlign: 'center',
                    }}
                >
                    {statusMsg}
                </p>
            )}
        </div>
    );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
    const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' });
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [alerts, setAlerts] = useState<Alert[]>([]);

    const data = fetchState.status === 'ok' ? fetchState.data : null;

    const poll = useCallback(async () => {
        const result = await fetchLatestTelemetry();
        setFetchState(result);
        if (result.status === 'ok') {
            setLastUpdated(new Date());
            setAlerts(deriveAlerts(result.data));
        }
    }, []);

    useEffect(() => {
        poll();
        const interval = setInterval(poll, POLL_INTERVAL * 1000);
        return () => clearInterval(interval);
    }, [poll]);

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
                <TelemetryCard label="SNR" value={fmt(data?.snr, 1)} unit="dB" level={snrLevel(data?.snr ?? null)} />
                <TelemetryCard label="Pressure" value={fmt(data?.pressure_hpa, 1)} unit="hPa" />
                <TelemetryCard label="Temperature" value={fmt(data?.temperature_c, 1)} unit="°C" />
                <TelemetryCard label="Stability" value={fmt(data?.stability_index, 0)} unit="/100" />
                {/* wind_gust_mph shown only when present (simulator only) */}
                {data?.wind_gust_mph != null && (
                    <TelemetryCard
                        label="Wind Gust"
                        value={fmt(data.wind_gust_mph, 1)}
                        unit="mph"
                        level={data.wind_gust_mph > 40 ? 'critical' : data.wind_gust_mph > 25 ? 'warning' : 'nominal'}
                    />
                )}
            </div>

            {/* ── Orientation + GPS ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <AccelCard ax={data?.accel_x ?? null} ay={data?.accel_y ?? null} az={data?.accel_z ?? null} />

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
                    Command acknowledgement is immediate; physical descent response may take a few seconds.
                </p>
                <DeflationButton />
            </div>

        </div>
    );
}