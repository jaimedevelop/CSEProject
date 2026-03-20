import { useState, useEffect, useRef, useCallback } from 'react';
import '../../styles/theme.css';
import {
    fetchLatestTelemetry,
    metersToFeet,
    type TelemetryPacket,
} from '../../services/telemetry';

const POLL_INTERVAL = 1_000; // ms — set to match packet cadence
const MAX_TRAIL = 60;         // keep last N positions in trail

// ─── Types ────────────────────────────────────────────────────────────────────

interface LatLng { lat: number; lng: number; }

interface GeofenceConfig {
    center: LatLng;
    radiusFt: number;
    maxAltitude: number; // feet
}

interface PredictionCone {
    center: LatLng;
    radiusFt: number;
    active: boolean;
}

// ─── SVG Map helpers ──────────────────────────────────────────────────────────

const W = 600, H = 500;
const FT_PER_DEG_LAT = 364_000;
const SCALE = 0.4;

function latLngToSVG(ll: LatLng, center: LatLng): { x: number; y: number } {
    const dx = (ll.lng - center.lng) * FT_PER_DEG_LAT * SCALE;
    const dy = -(ll.lat - center.lat) * FT_PER_DEG_LAT * SCALE;
    return { x: W / 2 + dx, y: H / 2 + dy };
}

function ftToSVGRadius(ft: number): number { return ft * SCALE; }

// ─── SVG Map ─────────────────────────────────────────────────────────────────

interface SVGMapProps {
    position: LatLng;
    altitudeFt: number;
    heading: number;
    trail: LatLng[];
    geofence: GeofenceConfig;
    cone: PredictionCone;
    showTrail: boolean;
    showCone: boolean;
    showGeofence: boolean;
    noData: boolean;
}

function SVGMap({ position, altitudeFt, heading, trail, geofence, cone, showTrail, showCone, showGeofence, noData }: SVGMapProps) {
    const bPt = latLngToSVG(position, geofence.center);
    const gfR = ftToSVGRadius(geofence.radiusFt);
    const cPt = latLngToSVG(cone.center, geofence.center);
    const cR = ftToSVGRadius(cone.radiusFt);

    const trailPts = trail
        .map(p => latLngToSVG(p, geofence.center))
        .map(p => `${p.x},${p.y}`)
        .join(' ');

    const c = {
        bg: '#f0f6ff', grid: '#bfdbfe', muted: '#94a3b8', secondary: '#475569',
        primary: '#2563eb', primaryLight: '#bfdbfe', warning: '#d97706',
        danger: '#dc2626', info: '#0284c7',
        hudBg: 'rgba(255,255,255,0.90)', hudBorder: '#bfdbfe', text: '#0f172a',
    };

    return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{
            background: c.bg, borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)',
        }}>
            {/* Grid */}
            {Array.from({ length: 11 }).map((_, i) => (
                <g key={i} stroke={c.grid} strokeWidth={1}>
                    <line x1={i * (W / 10)} y1={0} x2={i * (W / 10)} y2={H} />
                    <line x1={0} y1={i * (H / 10)} x2={W} y2={i * (H / 10)} />
                </g>
            ))}

            {/* Geofence */}
            {showGeofence && (
                <g>
                    <circle cx={W / 2} cy={H / 2} r={gfR}
                        fill="rgba(217,119,6,0.07)" stroke={c.warning} strokeWidth={2} strokeDasharray="8 4" />
                    <text x={W / 2} y={H / 2 - gfR - 8} textAnchor="middle"
                        fill={c.warning} fontSize={11} fontFamily="monospace" fontWeight="600">
                        GEOFENCE BOUNDARY
                    </text>
                    {[0, 90, 180, 270].map(deg => {
                        const rad = (deg - 90) * (Math.PI / 180);
                        return (
                            <text key={deg}
                                x={W / 2 + (gfR + 18) * Math.cos(rad)}
                                y={H / 2 + (gfR + 18) * Math.sin(rad) + 4}
                                textAnchor="middle" fill={c.muted} fontSize={10} fontFamily="monospace">
                                {['N', 'E', 'S', 'W'][deg / 90]}
                            </text>
                        );
                    })}
                </g>
            )}

            {/* Prediction cone */}
            {showCone && cone.active && (
                <g>
                    <circle cx={cPt.x} cy={cPt.y} r={cR}
                        fill="rgba(37,99,235,0.10)" stroke="rgba(37,99,235,0.45)"
                        strokeWidth={1.5} strokeDasharray="5 3" />
                    <text x={cPt.x} y={cPt.y - cR - 6} textAnchor="middle"
                        fill={c.info} fontSize={10} fontFamily="monospace" fontWeight="600">
                        95% LANDING ZONE
                    </text>
                </g>
            )}

            {/* Trail */}
            {showTrail && trail.length > 1 && (
                <polyline points={trailPts} fill="none"
                    stroke={c.primary} strokeWidth={1.5} strokeOpacity={0.45} strokeDasharray="3 2" />
            )}

            {/* Balloon marker */}
            {!noData && (
                <g transform={`translate(${bPt.x}, ${bPt.y})`}>
                    <line x1={0} y1={0} x2={0} y2={20} stroke={c.muted} strokeWidth={1.5} />
                    <ellipse cx={0} cy={-14} rx={10} ry={14}
                        fill={c.primary} fillOpacity={0.80} stroke={c.primaryLight} strokeWidth={1.5} />
                    <rect x={-5} y={6} width={10} height={6} rx={2}
                        fill="#e0f2fe" stroke={c.muted} strokeWidth={1} />
                    <line
                        x1={0} y1={-28}
                        x2={Math.sin((heading * Math.PI) / 180) * 6}
                        y2={-28 - Math.cos((heading * Math.PI) / 180) * 6}
                        stroke={c.text} strokeWidth={1.5} />
                    <circle cx={0} cy={0} r={16} fill="none" stroke={c.primary} strokeWidth={1} strokeOpacity={0.3}>
                        <animate attributeName="r" from="14" to="28" dur="2s" repeatCount="indefinite" />
                        <animate attributeName="opacity" from="0.4" to="0" dur="2s" repeatCount="indefinite" />
                    </circle>
                </g>
            )}

            {/* Anchor */}
            <circle cx={W / 2} cy={H / 2} r={4} fill={c.warning} />
            <text x={W / 2 + 8} y={H / 2 + 4} fill={c.warning} fontSize={10} fontFamily="monospace" fontWeight="600">
                ANCHOR
            </text>

            {/* HUD */}
            <rect x={10} y={10} width={160} height={44} rx={6} fill={c.hudBg} stroke={c.hudBorder} strokeWidth={1} />
            <text x={20} y={26} fill={c.secondary} fontSize={10} fontFamily="monospace">ALTITUDE</text>
            <text x={20} y={46} fill={noData ? c.muted : c.text} fontSize={18} fontFamily="monospace" fontWeight="bold">
                {noData ? '-- ft' : `${altitudeFt.toFixed(1)} ft`}
            </text>

            {/* No data overlay */}
            {noData && (
                <text x={W / 2} y={H / 2} textAnchor="middle"
                    fill={c.muted} fontSize={14} fontFamily="monospace">
                    Waiting for GPS data…
                </text>
            )}

            {/* Scale bar */}
            <g transform={`translate(${W - 110}, ${H - 24})`}>
                <line x1={0} y1={0} x2={50 * SCALE} y2={0} stroke={c.muted} strokeWidth={1.5} />
                <line x1={0} y1={-4} x2={0} y2={4} stroke={c.muted} strokeWidth={1.5} />
                <line x1={50 * SCALE} y1={-4} x2={50 * SCALE} y2={4} stroke={c.muted} strokeWidth={1.5} />
                <text x={50 * SCALE / 2} y={-6} textAnchor="middle" fill={c.muted} fontSize={9} fontFamily="monospace">50 ft</text>
            </g>
        </svg>
    );
}

// ─── Map Page ─────────────────────────────────────────────────────────────────

// Default center — will be replaced by first real GPS fix.
// Using Tampa Bay area to match your sample data.
const DEFAULT_CENTER: LatLng = { lat: 28.0, lng: -82.59 };

const DEFAULT_GEOFENCE: GeofenceConfig = {
    center: DEFAULT_CENTER,
    radiusFt: 5000,   // wide until we have a real fix to measure from
    maxAltitude: 20_000,
};

export default function Map() {
    const [position, setPosition] = useState<LatLng>(DEFAULT_CENTER);
    const [altitudeFt, setAltitudeFt] = useState(0);
    const [heading, setHeading] = useState(0);
    const [trail, setTrail] = useState<LatLng[]>([]);
    const [geofence, setGeofence] = useState<GeofenceConfig>(DEFAULT_GEOFENCE);
    const [cone, setCone] = useState<PredictionCone>({ center: DEFAULT_CENTER, radiusFt: 60, active: false });
    const [showTrail, setShowTrail] = useState(true);
    const [showCone, setShowCone] = useState(true);
    const [showGeofence, setShowGeofence] = useState(true);
    const [noData, setNoData] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const prevPos = useRef<LatLng | null>(null);

    const applyPacket = useCallback((p: TelemetryPacket) => {
        const newPos: LatLng = { lat: p.latitude, lng: p.longitude };
        const newAlt = metersToFeet(p.altitude_m);

        // Prefer onboard heading when available; fallback to track-derived heading.
        if (p.heading_deg != null) {
            const wrapped = ((p.heading_deg % 360) + 360) % 360;
            setHeading(wrapped);
        } else if (prevPos.current) {
            const dLat = newPos.lat - prevPos.current.lat;
            const dLng = newPos.lng - prevPos.current.lng;
            if (Math.abs(dLat) + Math.abs(dLng) > 1e-7) {
                const deg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
                setHeading((deg + 360) % 360);
            }
        }

        setTrail(prev => [...prev.slice(-(MAX_TRAIL - 1)), newPos]);
        setPosition(newPos);
        setAltitudeFt(newAlt);
        setLastUpdated(new Date());
        setNoData(false);
        prevPos.current = newPos;

        // Pin geofence center on first real fix
        setGeofence(prev =>
            prev.center === DEFAULT_CENTER
                ? { ...prev, center: newPos }
                : prev
        );
    }, []);

    const poll = useCallback(async () => {
        const result = await fetchLatestTelemetry();
        if (result.status === 'ok') applyPacket(result.data);
    }, [applyPacket]);

    useEffect(() => {
        poll();
        const id = setInterval(poll, POLL_INTERVAL);
        return () => clearInterval(id);
    }, [poll]);

    const handleShowCone = () => {
        setCone({ center: position, radiusFt: 300 + altitudeFt * 0.05, active: true });
        setShowCone(true);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 1000 }}>

            {/* ── Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                <div>
                    <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semi)', color: 'var(--color-text-primary)' }}>
                        Live Map View
                    </h2>
                    <p className="text-secondary text-sm" style={{ marginTop: 2 }}>
                        {lastUpdated
                            ? `Last GPS fix: ${lastUpdated.toLocaleTimeString()} · polling every ${POLL_INTERVAL / 1000}s`
                            : 'Waiting for first GPS fix…'}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    {[
                        { label: 'Trail', val: showTrail, fn: () => setShowTrail(v => !v) },
                        { label: 'Geofence', val: showGeofence, fn: () => setShowGeofence(v => !v) },
                        { label: 'Cone', val: showCone, fn: () => setShowCone(v => !v) },
                    ].map(({ label, val, fn }) => (
                        <button key={label} className={`btn btn-sm ${val ? 'btn-primary' : 'btn-ghost'}`} onClick={fn}>
                            {label}
                        </button>
                    ))}
                    <button className="btn btn-sm btn-danger" onClick={handleShowCone}>
                        Show Prediction Cone
                    </button>
                </div>
            </div>

            {/* ── SVG Map ── */}
            <SVGMap
                position={position}
                altitudeFt={altitudeFt}
                heading={heading}
                trail={trail}
                geofence={geofence}
                cone={cone}
                showTrail={showTrail}
                showCone={showCone}
                showGeofence={showGeofence}
                noData={noData}
            />

            {/* ── Info row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)' }}>
                <div className="card">
                    <div className="card-title">Balloon Position</div>
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span className="font-mono text-sm">{noData ? '--' : `${position.lat.toFixed(6)}° N`}</span>
                        <span className="font-mono text-sm">{noData ? '--' : `${Math.abs(position.lng).toFixed(6)}° W`}</span>
                        <span className="font-mono text-sm">{noData ? '--' : `${altitudeFt.toFixed(1)} ft AGL`}</span>
                    </div>
                </div>

                <div className="card">
                    <div className="card-title">Geofence Config</div>
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span className="font-mono text-sm">Radius: {geofence.radiusFt.toLocaleString()} ft</span>
                        <span className="font-mono text-sm">Max Alt: {geofence.maxAltitude.toLocaleString()} ft</span>
                        <span className="text-xs" style={{ color: 'var(--color-success)', marginTop: 4 }}>● Within bounds</span>
                    </div>
                </div>

                <div className="card">
                    <div className="card-title">Prediction Cone</div>
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {cone.active ? (
                            <>
                                <span className="font-mono text-sm">Radius: ±{cone.radiusFt.toFixed(0)} ft</span>
                                <span className="font-mono text-sm">{cone.center.lat.toFixed(5)}° N</span>
                                <span className="text-xs" style={{ color: 'var(--color-info)', marginTop: 4 }}>95% confidence</span>
                            </>
                        ) : (
                            <span className="text-secondary text-sm">Not active · click "Show Prediction Cone"</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}