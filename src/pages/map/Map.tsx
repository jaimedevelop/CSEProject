import { useState, useEffect, useRef } from 'react';
import '../../styles/theme.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LatLng { lat: number; lng: number; }

interface BalloonState {
    position: LatLng;
    altitude: number;   // feet
    heading: number;   // degrees 0–360
    trail: LatLng[];   // last N positions
}

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

// ─── Mock Data & Helpers ──────────────────────────────────────────────────────

const FT_PER_DEG_LAT = 364000;

function ftToDegLat(ft: number) { return ft / FT_PER_DEG_LAT; }

const GEOFENCE: GeofenceConfig = {
    center: { lat: 33.4484, lng: -112.0740 },
    radiusFt: 200,
    maxAltitude: 20,
};

const INITIAL_STATE: BalloonState = {
    position: { lat: 33.4484, lng: -112.0740 },
    altitude: 18.2,
    heading: 45,
    trail: [],
};

function randomWalk(pos: LatLng, radiusFt: number, center: LatLng): LatLng {
    const maxDelta = ftToDegLat(4);
    let next = {
        lat: pos.lat + (Math.random() - 0.5) * maxDelta,
        lng: pos.lng + (Math.random() - 0.5) * maxDelta,
    };
    const dLat = (next.lat - center.lat) * FT_PER_DEG_LAT;
    const dLng = (next.lng - center.lng) * FT_PER_DEG_LAT;
    const dist = Math.sqrt(dLat ** 2 + dLng ** 2);
    if (dist > radiusFt * 0.85) {
        next = {
            lat: center.lat + dLat / dist * (radiusFt * 0.7) / FT_PER_DEG_LAT,
            lng: center.lng + dLng / dist * (radiusFt * 0.7) / FT_PER_DEG_LAT,
        };
    }
    return next;
}

// ─── SVG Map Component ────────────────────────────────────────────────────────

const W = 600, H = 500;

function latLngToSVG(ll: LatLng, center: LatLng, scale: number): { x: number; y: number } {
    const dx = (ll.lng - center.lng) * FT_PER_DEG_LAT * scale;
    const dy = -(ll.lat - center.lat) * FT_PER_DEG_LAT * scale;
    return { x: W / 2 + dx, y: H / 2 + dy };
}

function ftToSVGRadius(ft: number, scale: number): number {
    return ft * scale;
}

interface SVGMapProps {
    balloon: BalloonState;
    geofence: GeofenceConfig;
    cone: PredictionCone;
    showTrail: boolean;
    showCone: boolean;
    showGeofence: boolean;
}

function SVGMap({ balloon, geofence, cone, showTrail, showCone, showGeofence }: SVGMapProps) {
    const scale = 0.4;

    const bPt = latLngToSVG(balloon.position, geofence.center, scale);
    const gfR = ftToSVGRadius(geofence.radiusFt, scale);
    const cPt = latLngToSVG(cone.center, geofence.center, scale);
    const cR = ftToSVGRadius(cone.radiusFt, scale);

    const trailPts = balloon.trail
        .map(p => latLngToSVG(p, geofence.center, scale))
        .map(p => `${p.x},${p.y}`)
        .join(' ');

    // Light-theme palette for the SVG (mirrors theme.css vars)
    const c = {
        bg: '#f0f6ff',   // --color-bg
        grid: '#bfdbfe',   // --color-border (blue-200)
        muted: '#94a3b8',   // --color-text-muted
        secondary: '#475569',   // --color-text-secondary
        primary: '#2563eb',   // --color-primary
        primaryLight: '#bfdbfe',   // --color-primary-light
        warning: '#d97706',   // --color-warning
        danger: '#dc2626',   // --color-danger
        info: '#0284c7',   // --color-info
        hudBg: 'rgba(255,255,255,0.90)',
        hudBorder: '#bfdbfe',
        text: '#0f172a',   // --color-text-primary
    };

    return (
        <svg
            width="100%"
            viewBox={`0 0 ${W} ${H}`}
            style={{
                background: c.bg,
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-sm)',
            }}
        >
            {/* Grid lines */}
            {Array.from({ length: 11 }).map((_, i) => (
                <g key={i} stroke={c.grid} strokeWidth={1}>
                    <line x1={i * (W / 10)} y1={0} x2={i * (W / 10)} y2={H} />
                    <line x1={0} y1={i * (H / 10)} x2={W} y2={i * (H / 10)} />
                </g>
            ))}

            {/* Geofence boundary */}
            {showGeofence && (
                <g>
                    <circle
                        cx={W / 2} cy={H / 2} r={gfR}
                        fill="rgba(217,119,6,0.07)"
                        stroke={c.warning}
                        strokeWidth={2}
                        strokeDasharray="8 4"
                    />
                    <text x={W / 2} y={H / 2 - gfR - 8} textAnchor="middle"
                        fill={c.warning} fontSize={11} fontFamily="monospace" fontWeight="600">
                        GEOFENCE BOUNDARY
                    </text>
                    {[0, 90, 180, 270].map(deg => {
                        const rad = (deg - 90) * (Math.PI / 180);
                        const tx = W / 2 + (gfR + 18) * Math.cos(rad);
                        const ty = H / 2 + (gfR + 18) * Math.sin(rad);
                        return (
                            <text key={deg} x={tx} y={ty + 4} textAnchor="middle"
                                fill={c.muted} fontSize={10} fontFamily="monospace">
                                {['N', 'E', 'S', 'W'][deg / 90]}
                            </text>
                        );
                    })}
                </g>
            )}

            {/* Prediction cone */}
            {showCone && cone.active && (
                <g>
                    <circle
                        cx={cPt.x} cy={cPt.y} r={cR}
                        fill="rgba(37,99,235,0.10)"
                        stroke="rgba(37,99,235,0.45)"
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                    />
                    <text x={cPt.x} y={cPt.y - cR - 6} textAnchor="middle"
                        fill={c.info} fontSize={10} fontFamily="monospace" fontWeight="600">
                        95% LANDING ZONE
                    </text>
                </g>
            )}

            {/* Balloon trail */}
            {showTrail && balloon.trail.length > 1 && (
                <polyline
                    points={trailPts}
                    fill="none"
                    stroke={c.primary}
                    strokeWidth={1.5}
                    strokeOpacity={0.45}
                    strokeDasharray="3 2"
                />
            )}

            {/* Balloon marker */}
            <g transform={`translate(${bPt.x}, ${bPt.y})`}>
                {/* Tether line */}
                <line x1={0} y1={0} x2={0} y2={20} stroke={c.muted} strokeWidth={1.5} />
                {/* Balloon envelope */}
                <ellipse cx={0} cy={-14} rx={10} ry={14}
                    fill={c.primary} fillOpacity={0.80}
                    stroke={c.primaryLight} strokeWidth={1.5} />
                {/* Gondola */}
                <rect x={-5} y={6} width={10} height={6} rx={2}
                    fill="#e0f2fe" stroke={c.muted} strokeWidth={1} />
                {/* Heading tick */}
                <line
                    x1={0} y1={-28}
                    x2={Math.sin((balloon.heading * Math.PI) / 180) * 6}
                    y2={-28 - Math.cos((balloon.heading * Math.PI) / 180) * 6}
                    stroke={c.text} strokeWidth={1.5}
                />
                {/* Pulse ring */}
                <circle cx={0} cy={0} r={16} fill="none" stroke={c.primary} strokeWidth={1} strokeOpacity={0.3}>
                    <animate attributeName="r" from="14" to="28" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" from="0.4" to="0" dur="2s" repeatCount="indefinite" />
                </circle>
            </g>

            {/* Center anchor dot */}
            <circle cx={W / 2} cy={H / 2} r={4} fill={c.warning} />
            <text x={W / 2 + 8} y={H / 2 + 4} fill={c.warning} fontSize={10} fontFamily="monospace" fontWeight="600">
                ANCHOR
            </text>

            {/* HUD overlay: altitude */}
            <rect x={10} y={10} width={140} height={44} rx={6}
                fill={c.hudBg} stroke={c.hudBorder} strokeWidth={1} />
            <text x={20} y={26} fill={c.secondary} fontSize={10} fontFamily="monospace">ALTITUDE</text>
            <text x={20} y={46} fill={c.text} fontSize={18} fontFamily="monospace" fontWeight="bold">
                {balloon.altitude.toFixed(1)} ft
            </text>

            {/* Scale bar */}
            <g transform={`translate(${W - 110}, ${H - 24})`}>
                <line x1={0} y1={0} x2={50 * scale} y2={0} stroke={c.muted} strokeWidth={1.5} />
                <line x1={0} y1={-4} x2={0} y2={4} stroke={c.muted} strokeWidth={1.5} />
                <line x1={50 * scale} y1={-4} x2={50 * scale} y2={4} stroke={c.muted} strokeWidth={1.5} />
                <text x={50 * scale / 2} y={-6} textAnchor="middle"
                    fill={c.muted} fontSize={9} fontFamily="monospace">
                    50 ft
                </text>
            </g>
        </svg>
    );
}

// ─── Map Page ─────────────────────────────────────────────────────────────────

export default function Map() {
    const [balloon, setBalloon] = useState<BalloonState>(INITIAL_STATE);
    const [cone, setCone] = useState<PredictionCone>({ center: INITIAL_STATE.position, radiusFt: 60, active: false });
    const [showTrail, setShowTrail] = useState(true);
    const [showCone, setShowCone] = useState(true);
    const [showGeofence, setShowGeofence] = useState(true);
    const [geofence] = useState<GeofenceConfig>(GEOFENCE);
    const intervalRef = useRef<number | null>(null);

    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setBalloon(prev => {
                const newPos = randomWalk(prev.position, geofence.radiusFt, geofence.center);
                const trail = [...prev.trail.slice(-29), prev.position];
                const heading = (Math.atan2(newPos.lng - prev.position.lng, newPos.lat - prev.position.lat) * 180) / Math.PI;
                return { ...prev, position: newPos, altitude: Math.max(0, prev.altitude + (Math.random() - 0.5) * 0.3), heading, trail };
            });
        }, 10_000);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [geofence]);

    const handleShowCone = () => {
        setCone({
            center: balloon.position,
            radiusFt: 60 + balloon.altitude * 2.5,
            active: true,
        });
        setShowCone(true);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 1000 }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semi)', color: 'var(--color-text-primary)' }}>
                        Live Map View
                    </h2>
                    <p className="text-secondary text-sm" style={{ marginTop: 2 }}>
                        Top-down view · Placeholder SVG — Mapbox GL / CesiumJS in production
                    </p>
                </div>

                {/* Layer toggles */}
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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

            {/* SVG Map */}
            <SVGMap
                balloon={balloon}
                geofence={geofence}
                cone={cone}
                showTrail={showTrail}
                showCone={showCone}
                showGeofence={showGeofence}
            />

            {/* Info row below map */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)' }}>

                <div className="card">
                    <div className="card-title">Balloon Position</div>
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span className="font-mono text-sm">{balloon.position.lat.toFixed(6)}° N</span>
                        <span className="font-mono text-sm">{Math.abs(balloon.position.lng).toFixed(6)}° W</span>
                        <span className="font-mono text-sm">{balloon.altitude.toFixed(1)} ft AGL</span>
                    </div>
                </div>

                <div className="card">
                    <div className="card-title">Geofence Config</div>
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span className="font-mono text-sm">Radius: {geofence.radiusFt} ft</span>
                        <span className="font-mono text-sm">Max Alt: {geofence.maxAltitude} ft</span>
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