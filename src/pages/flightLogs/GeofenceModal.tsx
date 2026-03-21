import { useState } from 'react';
import { fetchLatestTelemetry } from '../../services/telemetry';

export interface GeofenceInput {
    latitude: number;
    longitude: number;
    radius: number;        // meters
    maxAltitude: number;   // meters
}

interface GeofenceModalProps {
    isOpen: boolean;
    onConfirm: (geofence: GeofenceInput) => void;
    onCancel: () => void;
    isLoading?: boolean;
}

export function GeofenceModal({ isOpen, onConfirm, onCancel, isLoading = false }: GeofenceModalProps) {
    const [latitude, setLatitude] = useState('0');
    const [longitude, setLongitude] = useState('0');
    const [radius, setRadius] = useState('0');           // 5 km in meters
    const [maxAltitude, setMaxAltitude] = useState('0'); // 30 km in meters
    const [error, setError] = useState('');
    const [loadingLocation, setLoadingLocation] = useState(false);

    const handleUseCurrentLocation = async () => {
        setLoadingLocation(true);
        setError('');
        try {
            const state = await fetchLatestTelemetry();
            if (state.status === 'ok' && state.data) {
                setLatitude(state.data.latitude.toFixed(6));
                setLongitude(state.data.longitude.toFixed(6));
            } else {
                setError('Could not fetch current GPS location');
            }
        } catch {
            setError('Failed to fetch current location');
        } finally {
            setLoadingLocation(false);
        }
    };

    const handleSubmit = () => {
        setError('');
        
        // Validate inputs
        const lat = parseFloat(latitude);
        const lon = parseFloat(longitude);
        const rad = parseFloat(radius);
        const maxAlt = parseFloat(maxAltitude);

        if (isNaN(lat) || lat < -90 || lat > 90) {
            setError('Invalid latitude (-90 to 90)');
            return;
        }
        if (isNaN(lon) || lon < -180 || lon > 180) {
            setError('Invalid longitude (-180 to 180)');
            return;
        }
        if (isNaN(rad) || rad <= 0) {
            setError('Radius must be > 0 meters');
            return;
        }
        if (isNaN(maxAlt) || maxAlt <= 0) {
            setError('Max altitude must be > 0 meters');
            return;
        }

        // Save geofence to localStorage for map display
        localStorage.setItem('geofence', JSON.stringify({
            latitude: lat,
            longitude: lon,
            radius: rad,
            maxAltitude: maxAlt,
        }));

        onConfirm({ latitude: lat, longitude: lon, radius: rad, maxAltitude: maxAlt });
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
        }}>
            <div style={{
                backgroundColor: 'var(--color-bg-panel)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                padding: 'var(--space-6)',
                maxWidth: 450,
                width: '90%',
                maxHeight: '90vh',
                overflow: 'auto',
            }}>
                <h2 style={{
                    fontSize: 'var(--text-lg)',
                    fontWeight: 'var(--font-semi)',
                    marginBottom: 'var(--space-4)',
                    color: 'var(--color-text-primary)',
                }}>
                    Set Geofence
                </h2>

                <p style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-secondary)',
                    marginBottom: 'var(--space-4)',
                }}>
                    Define the flight boundary before starting. Entered coordinates must be integers in firmware format (degrees × 10⁷).
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    {/* Latitude */}
                    <div>
                        <label style={{
                            display: 'block',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--font-semi)',
                            marginBottom: 'var(--space-1)',
                            color: 'var(--color-text-primary)',
                        }}>
                            Latitude (decimal)
                        </label>
                        <input
                            type="text"
                            value={latitude}
                            onChange={(e) => setLatitude(e.target.value)}
                            disabled={isLoading || loadingLocation}
                            placeholder="27.9947"
                            style={{
                                width: '100%',
                                padding: 'var(--space-2) var(--space-3)',
                                fontSize: 'var(--text-sm)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--color-bg-input)',
                                color: 'var(--color-text-primary)',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    {/* Longitude */}
                    <div>
                        <label style={{
                            display: 'block',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--font-semi)',
                            marginBottom: 'var(--space-1)',
                            color: 'var(--color-text-primary)',
                        }}>
                            Longitude (decimal)
                        </label>
                        <input
                            type="text"
                            value={longitude}
                            onChange={(e) => setLongitude(e.target.value)}
                            disabled={isLoading || loadingLocation}
                            placeholder="-82.5943"
                            style={{
                                width: '100%',
                                padding: 'var(--space-2) var(--space-3)',
                                fontSize: 'var(--text-sm)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--color-bg-input)',
                                color: 'var(--color-text-primary)',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    {/* Radius */}
                    <div>
                        <label style={{
                            display: 'block',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--font-semi)',
                            marginBottom: 'var(--space-1)',
                            color: 'var(--color-text-primary)',
                        }}>
                            Radius (meters)
                        </label>
                        <input
                            type="text"
                            value={radius}
                            onChange={(e) => setRadius(e.target.value)}
                            disabled={isLoading || loadingLocation}
                            placeholder="5000"
                            style={{
                                width: '100%',
                                padding: 'var(--space-2) var(--space-3)',
                                fontSize: 'var(--text-sm)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--color-bg-input)',
                                color: 'var(--color-text-primary)',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    {/* Max Altitude */}
                    <div>
                        <label style={{
                            display: 'block',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--font-semi)',
                            marginBottom: 'var(--space-1)',
                            color: 'var(--color-text-primary)',
                        }}>
                            Max Altitude (meters)
                        </label>
                        <input
                            type="text"
                            value={maxAltitude}
                            onChange={(e) => setMaxAltitude(e.target.value)}
                            disabled={isLoading || loadingLocation}
                            placeholder="30000"
                            style={{
                                width: '100%',
                                padding: 'var(--space-2) var(--space-3)',
                                fontSize: 'var(--text-sm)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--color-bg-input)',
                                color: 'var(--color-text-primary)',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>

                    {/* Current Location Button */}
                    <button
                        onClick={handleUseCurrentLocation}
                        disabled={isLoading || loadingLocation}
                        style={{
                            padding: 'var(--space-2) var(--space-4)',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--font-semi)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-bg-card)',
                            color: 'var(--color-text-primary)',
                            cursor: loadingLocation ? 'wait' : 'pointer',
                            opacity: isLoading || loadingLocation ? 0.6 : 1,
                        }}
                    >
                        {loadingLocation ? '📍 Fetching location…' : '📍 Use Current Location'}
                    </button>

                    {/* Error Message */}
                    {error && (
                        <div style={{
                            padding: 'var(--space-2) var(--space-3)',
                            backgroundColor: 'var(--color-danger-bg)',
                            borderRadius: 'var(--radius-md)',
                            color: 'var(--color-danger)',
                            fontSize: 'var(--text-sm)',
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
                        <button
                            onClick={onCancel}
                            disabled={isLoading}
                            style={{
                                padding: 'var(--space-2) var(--space-4)',
                                fontSize: 'var(--text-sm)',
                                fontWeight: 'var(--font-semi)',
                                borderRadius: 'var(--radius-md)',
                                border: 'none',
                                backgroundColor: 'var(--color-bg-card)',
                                color: 'var(--color-text-primary)',
                                cursor: 'pointer',
                                opacity: isLoading ? 0.6 : 1,
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={isLoading}
                            style={{
                                padding: 'var(--space-2) var(--space-4)',
                                fontSize: 'var(--text-sm)',
                                fontWeight: 'var(--font-semi)',
                                borderRadius: 'var(--radius-md)',
                                border: 'none',
                                backgroundColor: isLoading ? '#9ca3af' : 'var(--color-primary)',
                                color: 'var(--color-text-inverse)',
                                cursor: isLoading ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {isLoading ? '🔄 Sending…' : 'Start Flight'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
