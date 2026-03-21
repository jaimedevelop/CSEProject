import { useState, useEffect, useRef, useCallback } from 'react';
import { Circle, CircleMarker, MapContainer, Polyline, ScaleControl, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '../../styles/theme.css';
import {
    fetchFlightPackets,
    fetchFlightStatus,
    fetchLatestTelemetry,
    getMapReplaySelection,
    metersToFeet,
    setMapReplaySelection,
    type TelemetryPacket,
} from '../../services/telemetry';

// ─── Configuration ────────────────────────────────────────────────────────────

const POLL_INTERVAL = 5_00; // ms — set to match packet cadence

/** Hardcoded geofence — will be made configurable from the webapp later */
const HARDCODED_GEOFENCE = {
    centerLat: 0,   // 27.964020°
    centerLng: 0,  // -82.233410°
    radiusMeters: 0,                // 50 km radius
    maxAltMeters: 0,                   // 100 m ceiling
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface LatLng { lat: number; lng: number; }

interface TrailPoint extends LatLng {
    det: boolean;
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

function feetToMeters(feet: number): number {
    return feet / 3.28084;
}

function projectHeadingPoint(origin: LatLng, headingDeg: number, distanceFt: number): LatLng {
    const distanceDegLat = distanceFt / 364_000;
    const rad = (headingDeg * Math.PI) / 180;
    const dLat = Math.cos(rad) * distanceDegLat;
    const cosLat = Math.cos((origin.lat * Math.PI) / 180);
    const safeCosLat = Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat;
    const dLng = (Math.sin(rad) * distanceDegLat) / safeCosLat;

    return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}

function RecenterOnPosition({ position, noData }: { position: LatLng; noData: boolean }) {
    const map = useMap();

    useEffect(() => {
        if (noData) return;
        map.panTo([position.lat, position.lng], { animate: true, duration: 0.5 });
    }, [map, noData, position.lat, position.lng]);

    return null;
}

interface LiveTileMapProps {
    position: LatLng;
    altitudeFt: number;
    heading: number;
    trail: TrailPoint[];
    geofence: GeofenceConfig;
    cone: PredictionCone;
    showTrail: boolean;
    showCone: boolean;
    showGeofence: boolean;
    noData: boolean;
}

function LiveTileMap({ position, altitudeFt, heading, trail, geofence, cone, showTrail, showCone, showGeofence, noData }: LiveTileMapProps) {
    const headingPoint = projectHeadingPoint(position, heading, 20);
    const firstDetIndex = trail.findIndex(p => p.det);
    const preDetTrail = firstDetIndex > 0 ? trail.slice(0, firstDetIndex + 1) : trail;
    const postDetTrail = firstDetIndex >= 0 ? trail.slice(firstDetIndex) : [];
    const firstDetPoint = firstDetIndex >= 0 ? trail[firstDetIndex] : null;

    return (
        <div style={{
            height: 500,
            width: '100%',
            overflow: 'hidden',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)',
        }}>
            <MapContainer
                center={[position.lat, position.lng]}
                zoom={19}
                minZoom={4}
                maxZoom={22}
                scrollWheelZoom
                style={{ height: '100%', width: '100%' }}
            >
                <ScaleControl position="bottomleft" imperial={false} />

                {/* Free, no-key satellite raster tiles. */}
                <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    attribution="Tiles &copy; Esri"
                    maxNativeZoom={19}
                    maxZoom={22}
                />

                {!noData && <RecenterOnPosition position={position} noData={noData} />}

                {showGeofence && geofence.radiusFt > 0 && (
                    <Circle
                        center={[geofence.center.lat, geofence.center.lng]}
                        radius={feetToMeters(geofence.radiusFt)}
                        pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.08, dashArray: '8 6' }}
                    >
                        <Tooltip sticky>Geofence boundary</Tooltip>
                    </Circle>
                )}

                {showCone && cone.active && (
                    <Circle
                        center={[cone.center.lat, cone.center.lng]}
                        radius={feetToMeters(cone.radiusFt)}
                        pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.12, dashArray: '6 5' }}
                    >
                        <Tooltip sticky>95% landing zone</Tooltip>
                    </Circle>
                )}

                {showTrail && preDetTrail.length > 1 && (
                    <Polyline
                        positions={preDetTrail.map(p => [p.lat, p.lng] as [number, number])}
                        pathOptions={{ color: '#22c55e', weight: 3, opacity: 0.85 }}
                    />
                )}

                {showTrail && postDetTrail.length > 1 && (
                    <Polyline
                        positions={postDetTrail.map(p => [p.lat, p.lng] as [number, number])}
                        pathOptions={{ color: '#ef4444', weight: 3, opacity: 0.9 }}
                    />
                )}

                {showTrail && firstDetPoint && (
                    <CircleMarker
                        center={[firstDetPoint.lat, firstDetPoint.lng]}
                        radius={7}
                        pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }}
                    >
                        <Tooltip sticky>First detonation event</Tooltip>
                    </CircleMarker>
                )}

                {!noData && (
                    <>
                        <Polyline
                            positions={[
                                [position.lat, position.lng],
                                [headingPoint.lat, headingPoint.lng],
                            ]}
                            pathOptions={{ color: '#ffffff', weight: 2, opacity: 0.9 }}
                        />
                        <CircleMarker
                            center={[position.lat, position.lng]}
                            radius={8}
                            pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }}
                        >
                            <Tooltip direction="top" offset={[0, -8]}>
                                Balloon · {feetToMeters(altitudeFt).toFixed(1)} m
                            </Tooltip>
                        </CircleMarker>
                    </>
                )}
            </MapContainer>
        </div>
    );
}

// ─── Map Page ─────────────────────────────────────────────────────────────────

// Default center — updated by first real GPS fix or uses hardcoded geofence
const DEFAULT_CENTER: LatLng = { 
    lat: HARDCODED_GEOFENCE.centerLat, 
    lng: HARDCODED_GEOFENCE.centerLng 
};

const DEFAULT_GEOFENCE: GeofenceConfig = {
    center: { lat: 0, lng: 0 },
    radiusFt: 0,
    maxAltitude: 0,
};

export default function Map() {
    const [position, setPosition] = useState<LatLng>(DEFAULT_CENTER);
    const [altitudeFt, setAltitudeFt] = useState(0);
    const [heading, setHeading] = useState(0);
    const [trail, setTrail] = useState<TrailPoint[]>([]);
    
    // Load geofence from localStorage if available, otherwise use default
    const [geofence, setGeofence] = useState<GeofenceConfig>(() => {
        try {
            const stored = localStorage.getItem('geofence');
            if (stored) {
                const { latitude, longitude, radius, maxAltitude } = JSON.parse(stored);
                return {
                    center: { lat: latitude, lng: longitude },
                    radiusFt: radius * 3.28084, // convert m to ft
                    maxAltitude: maxAltitude * 3.28084, // convert m to ft
                };
            }
        } catch {
            // Fall through to default on parse error
        }
        return DEFAULT_GEOFENCE;
    });
    
    const [cone, setCone] = useState<PredictionCone>({ center: DEFAULT_CENTER, radiusFt: 60, active: false });
    const [showTrail, setShowTrail] = useState(true);
    const [showCone, setShowCone] = useState(true);
    const [showGeofence, setShowGeofence] = useState(true);
    const [noData, setNoData] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [activeFlightName, setActiveFlightName] = useState<string | null>(null);
    const [replayFlightName, setReplayFlightName] = useState<string | null>(null);
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

        setPosition(newPos);
        setAltitudeFt(newAlt);
        setLastUpdated(new Date());
        setNoData(false);
        prevPos.current = newPos;

        // If geofence is at default (0,0,0,0), initialize it to balloon position with 0 radius/altitude
        setGeofence(prev => {
            if (prev.center.lat === 0 && prev.center.lng === 0 && prev.radiusFt === 0 && prev.maxAltitude === 0) {
                return {
                    center: { lat: p.latitude, lng: p.longitude },
                    radiusFt: 0,
                    maxAltitude: 0,
                };
            }
            return prev;
        });
    }, []);

    const syncCurrentFlightTrail = useCallback(async () => {
        const active = await fetchFlightStatus();
        if (!active) {
            setActiveFlightName(null);
            setTrail([]);
            setGeofence(prev => {
                const center = prevPos.current ?? { lat: 0, lng: 0 };
                if (
                    prev.center.lat === center.lat &&
                    prev.center.lng === center.lng &&
                    prev.radiusFt === 0 &&
                    prev.maxAltitude === 0
                ) {
                    return prev;
                }
                return {
                    center,
                    radiusFt: 0,
                    maxAltitude: 0,
                };
            });
            return;
        }

        setActiveFlightName(active.name);
        const { packets } = await fetchFlightPackets(active.id);
        const fullTrail = packets.map(p => ({ lat: p.latitude, lng: p.longitude, det: Boolean(p.det) }));
        setTrail(fullTrail);

        const latest = packets[packets.length - 1];
        if (!latest) return;

        const latestPos: LatLng = { lat: latest.latitude, lng: latest.longitude };
        setPosition(latestPos);
        setAltitudeFt(metersToFeet(latest.altitude_m));
        if (latest.heading_deg != null) {
            const wrapped = ((latest.heading_deg % 360) + 360) % 360;
            setHeading(wrapped);
        }

        const ts = new Date(latest.timestamp);
        setLastUpdated(Number.isNaN(ts.getTime()) ? new Date() : ts);
        setNoData(false);
        prevPos.current = latestPos;
    }, []);

    const syncReplayFlight = useCallback(async (flightId: string) => {
        const { flight, packets } = await fetchFlightPackets(flightId);
        if (!flight) {
            setMapReplaySelection(null);
            setReplayFlightName(null);
            return;
        }

        setReplayFlightName(flight.name);
        setActiveFlightName(null);

        const fullTrail = packets.map(p => ({ lat: p.latitude, lng: p.longitude, det: Boolean(p.det) }));
        setTrail(fullTrail);

        if (
            flight.geofence_latitude != null &&
            flight.geofence_longitude != null &&
            flight.geofence_radius_m != null &&
            flight.geofence_max_altitude_m != null
        ) {
            setGeofence({
                center: { lat: flight.geofence_latitude, lng: flight.geofence_longitude },
                radiusFt: metersToFeet(flight.geofence_radius_m),
                maxAltitude: metersToFeet(flight.geofence_max_altitude_m),
            });
        }

        const latest = packets[packets.length - 1];
        if (!latest) {
            setNoData(true);
            return;
        }

        const latestPos: LatLng = { lat: latest.latitude, lng: latest.longitude };
        setPosition(latestPos);
        setAltitudeFt(metersToFeet(latest.altitude_m));
        if (latest.heading_deg != null) {
            const wrapped = ((latest.heading_deg % 360) + 360) % 360;
            setHeading(wrapped);
        }
        const ts = new Date(latest.timestamp);
        setLastUpdated(Number.isNaN(ts.getTime()) ? new Date() : ts);
        setNoData(false);
        prevPos.current = latestPos;
    }, []);

    const pollLiveMarker = useCallback(async () => {
        const result = await fetchLatestTelemetry();
        if (result.status === 'ok') applyPacket(result.data);
    }, [applyPacket]);

    useEffect(() => {
        const tick = async () => {
            const replay = getMapReplaySelection();
            if (replay) {
                await syncReplayFlight(replay.flightId);
                return;
            }
            setReplayFlightName(null);
            await pollLiveMarker();
            await syncCurrentFlightTrail();
        };

        void tick();
        const id = setInterval(() => {
            void tick();
        }, POLL_INTERVAL);
        return () => clearInterval(id);
    }, [pollLiveMarker, syncCurrentFlightTrail, syncReplayFlight]);

    // Listen for geofence changes from localStorage
    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'geofence' && e.newValue) {
                try {
                    const { latitude, longitude, radius, maxAltitude } = JSON.parse(e.newValue);
                    setGeofence({
                        center: { lat: latitude, lng: longitude },
                        radiusFt: radius * 3.28084,
                        maxAltitude: maxAltitude * 3.28084,
                    });
                } catch {
                    // Ignore parse errors
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    // Calculate distance from balloon to geofence center
    const distanceFromCenter = (() => {
        if (noData) return null;
        const dLat = position.lat - geofence.center.lat;
        const dLng = position.lng - geofence.center.lng;
        // Rough approximation: 1 degree lat ≈ 364,000 ft, 1 degree lng varies by latitude
        const ftPerDegLat = 364_000;
        const ftPerDegLng = Math.cos((position.lat * Math.PI) / 180) * 364_000;
        const distFt = Math.sqrt(Math.pow(dLat * ftPerDegLat, 2) + Math.pow(dLng * ftPerDegLng, 2));
        return distFt;
    })();

    const isWithinGeofence = distanceFromCenter != null && distanceFromCenter <= geofence.radiusFt;
    const isWithinAltitude = altitudeFt <= geofence.maxAltitude;

    const handleShowCone = () => {
        setCone({ center: position, radiusFt: 300 + altitudeFt * 0.05, active: true });
        setShowCone(true);
    };

    const handleExitReplay = () => {
        setMapReplaySelection(null);
        setReplayFlightName(null);
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
                    <p className="text-secondary text-sm" style={{ marginTop: 2 }}>
                        {replayFlightName
                            ? `Trail source: ${replayFlightName} (replay mode)`
                            : activeFlightName
                                ? `Trail source: ${activeFlightName} (current flight, full path)`
                                : 'Trail source: no active flight'}
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

            {replayFlightName && (
                <button
                    className="alert-banner alert-banner-warning"
                    onClick={handleExitReplay}
                    title="Exit replay mode"
                    style={{
                        width: '100%',
                        justifyContent: 'space-between',
                        fontSize: 'var(--text-base)',
                        fontWeight: 'var(--font-semi)',
                        padding: 'var(--space-3) var(--space-4)',
                        cursor: 'pointer',
                    }}
                >
                    <span>⏪ REPLAY MODE: {replayFlightName}</span>
                    <span>Click to exit</span>
                </button>
            )}

            {/* ── Live Tile Map ── */}
            <LiveTileMap
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
                        <span className="font-mono text-sm">{noData ? '--' : `${feetToMeters(altitudeFt).toFixed(1)} m AGL`}</span>
                    </div>
                </div>

                <div className="card">
                    <div className="card-title">Geofence Status</div>
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {geofence.radiusFt === 0 && geofence.center.lat === 0 && geofence.center.lng === 0 ? (
                            <span className="text-secondary text-sm">Not configured · set in Flight Logs before starting</span>
                        ) : (
                            <>
                                <span className="font-mono text-sm">Radius: {feetToMeters(geofence.radiusFt).toLocaleString(undefined, { maximumFractionDigits: 0 })} m</span>
                                <span className="font-mono text-sm">Max Alt: {feetToMeters(geofence.maxAltitude).toLocaleString(undefined, { maximumFractionDigits: 0 })} m</span>
                                {noData ? (
                                    <span className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>⏳ Waiting for GPS…</span>
                                ) : (
                                    <>
                                        <span className="font-mono text-xs text-muted" style={{ marginTop: 4 }}>
                                            Distance: {feetToMeters(distanceFromCenter!).toLocaleString(undefined, { maximumFractionDigits: 0 })} m
                                        </span>
                                        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 6 }}>
                                            <span className="text-xs" style={{ color: isWithinGeofence ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                                {isWithinGeofence ? '✓ Radius OK' : '✗ Outside bound'}
                                            </span>
                                            <span className="text-xs" style={{ color: isWithinAltitude ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                                {isWithinAltitude ? '✓ Alt OK' : '✗ Too high'}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-title">Prediction Cone</div>
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {cone.active ? (
                            <>
                                <span className="font-mono text-sm">Radius: ±{feetToMeters(cone.radiusFt).toFixed(0)} m</span>
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