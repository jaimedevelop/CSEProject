import { useState } from 'react';
import '../../styles/theme.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GeofenceConfig {
    radiusFt: number;
    maxAltitude: number; // feet
    centerLat: number;
    centerLng: number;
}

interface AlertThresholds {
    batteryWarnPct: number; // default 20
    batteryCritPct: number; // default 5 (auto-deflate)
    signalWarnDbm: number; // default -110
    windGustMph: number; // default 40
    pressureDropMb: number; // default 4 (over 3 hrs)
    pressureThreshMb: number; // default 1009
}

interface OperatorProfile {
    name: string;
    siteName: string;
    notes: string;
}

interface Settings {
    geofence: GeofenceConfig;
    thresholds: AlertThresholds;
    operator: OperatorProfile;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
    geofence: {
        radiusFt: 200,
        maxAltitude: 20,
        centerLat: 33.4484,
        centerLng: -112.0740,
    },
    thresholds: {
        batteryWarnPct: 20,
        batteryCritPct: 5,
        signalWarnDbm: -110,
        windGustMph: 40,
        pressureDropMb: 4,
        pressureThreshMb: 1009,
    },
    operator: {
        name: '',
        siteName: '',
        notes: '',
    },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
        <div style={{ marginBottom: 'var(--space-4)' }}>
            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semi)', color: 'var(--color-text-primary)' }}>
                {title}
            </h3>
            {subtitle && (
                <p className="text-secondary text-sm" style={{ marginTop: 2 }}>{subtitle}</p>
            )}
        </div>
    );
}

function Field({
    label, hint, children
}: {
    label: string; hint?: string; children: React.ReactNode;
}) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label className="label">{label}</label>
            {children}
            {hint && <span className="text-xs text-muted">{hint}</span>}
        </div>
    );
}

function NumericField({
    label, hint, value, min, max, step = 1, unit,
    onChange
}: {
    label: string; hint?: string; value: number; min: number; max: number;
    step?: number; unit?: string; onChange: (v: number) => void;
}) {
    return (
        <Field label={label} hint={hint}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input
                    type="number"
                    className="input"
                    value={value}
                    min={min}
                    max={max}
                    step={step}
                    onChange={e => onChange(parseFloat(e.target.value))}
                    style={{ maxWidth: 140 }}
                />
                {unit && <span className="text-secondary text-sm">{unit}</span>}
            </div>
        </Field>
    );
}

function SaveBanner({ saved }: { saved: boolean }) {
    if (!saved) return null;
    return (
        <div className="alert-banner alert-banner-info" style={{ borderColor: 'var(--color-success)', background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
            <span>✅</span>
            <span>Settings saved successfully. New values will take effect on next launch.</span>
        </div>
    );
}

// ─── UserSettings ─────────────────────────────────────────────────────────────

export default function UserSettings() {
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [saved, setSaved] = useState(false);
    const [activeTab, setActiveTab] = useState<'geofence' | 'alerts' | 'operator'>('geofence');

    const updateGeofence = (patch: Partial<GeofenceConfig>) => setSettings(s => ({ ...s, geofence: { ...s.geofence, ...patch } }));
    const updateThresholds = (patch: Partial<AlertThresholds>) => setSettings(s => ({ ...s, thresholds: { ...s.thresholds, ...patch } }));
    const updateOperator = (patch: Partial<OperatorProfile>) => setSettings(s => ({ ...s, operator: { ...s.operator, ...patch } }));

    const handleSave = () => {
        // TODO: push to telemetryService / device config endpoint
        console.log('Saving settings:', settings);
        setSaved(true);
        setTimeout(() => setSaved(false), 4000);
    };

    const handleReset = () => {
        setSettings(DEFAULT_SETTINGS);
        setSaved(false);
    };

    const tabs: { key: typeof activeTab; label: string }[] = [
        { key: 'geofence', label: '📍 Geofence & Altitude' },
        { key: 'alerts', label: '⚠️ Alert Thresholds' },
        { key: 'operator', label: '👤 Operator Profile' },
    ];

    const { geofence, thresholds, operator } = settings;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 720 }}>

            {/* Header */}
            <div>
                <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semi)' }}>Pre-Launch Settings</h2>
                <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
                    Configure site-specific safety boundaries and alert thresholds before flight.
                    All values must be set before launch.
                </p>
            </div>

            <SaveBanner saved={saved} />

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-2)' }}>
                {tabs.map(t => (
                    <button
                        key={t.key}
                        className={`btn btn-sm ${activeTab === t.key ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setActiveTab(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ── Tab: Geofence & Altitude ── */}
            {activeTab === 'geofence' && (
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                    <SectionHeader
                        title="Geofence & Altitude Boundaries"
                        subtitle="The system will automatically trigger rapid deflation within 5 seconds if these boundaries are breached."
                    />

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                        <NumericField
                            label="Geofence Radius"
                            hint="Horizontal boundary from anchor point. Max safe: 500 ft."
                            value={geofence.radiusFt}
                            min={50} max={500} step={10} unit="ft"
                            onChange={v => updateGeofence({ radiusFt: v })}
                        />
                        <NumericField
                            label="Max Altitude"
                            hint="FAA assumption: do not exceed 20 ft AGL without additional clearance."
                            value={geofence.maxAltitude}
                            min={5} max={20} step={1} unit="ft AGL"
                            onChange={v => updateGeofence({ maxAltitude: v })}
                        />
                    </div>

                    <div style={{ padding: 'var(--space-3)', background: 'var(--color-warning-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-warning)' }}>
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)', lineHeight: 1.6 }}>
                            ⚠️ <strong>FAA Requirement:</strong> This balloon must be launched at least 5 miles from any airport.
                            Maximum altitude is capped at 20 ft per project safety assumptions. Setting max altitude above 20 ft
                            is not permitted.
                        </p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                        <NumericField
                            label="Anchor Latitude"
                            hint="Decimal degrees — set at launch site."
                            value={geofence.centerLat}
                            min={-90} max={90} step={0.0001} unit="°N"
                            onChange={v => updateGeofence({ centerLat: v })}
                        />
                        <NumericField
                            label="Anchor Longitude"
                            hint="Decimal degrees — set at launch site."
                            value={geofence.centerLng}
                            min={-180} max={180} step={0.0001} unit="°"
                            onChange={v => updateGeofence({ centerLng: v })}
                        />
                    </div>

                    {/* Summary */}
                    <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                        <p className="text-xs text-muted" style={{ marginBottom: 4 }}>CONFIGURED BOUNDARY</p>
                        <p className="font-mono text-sm">
                            Circle · r = {geofence.radiusFt} ft · max {geofence.maxAltitude} ft AGL ·{' '}
                            {geofence.centerLat.toFixed(4)}°, {geofence.centerLng.toFixed(4)}°
                        </p>
                    </div>
                </div>
            )}

            {/* ── Tab: Alert Thresholds ── */}
            {activeTab === 'alerts' && (
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                    <SectionHeader
                        title="Alert & Auto-Deflation Thresholds"
                        subtitle="Conditions that trigger operator alerts or automatic deflation sequences."
                    />

                    {/* Battery */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        <p style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semi)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Battery
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                            <NumericField
                                label="Warning Threshold"
                                hint="Operator alert is triggered below this level."
                                value={thresholds.batteryWarnPct}
                                min={10} max={50} step={1} unit="%"
                                onChange={v => updateThresholds({ batteryWarnPct: v })}
                            />
                            <NumericField
                                label="Auto-Deflation Threshold"
                                hint="Balloon automatically deflates below this level. Min: 5%."
                                value={thresholds.batteryCritPct}
                                min={5} max={15} step={1} unit="%"
                                onChange={v => updateThresholds({ batteryCritPct: Math.max(5, v) })}
                            />
                        </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        <p style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semi)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Signal & Wind
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                            <NumericField
                                label="Min Signal Strength"
                                hint="Alert if signal drops below this dBm value."
                                value={thresholds.signalWarnDbm}
                                min={-130} max={-60} step={1} unit="dBm"
                                onChange={v => updateThresholds({ signalWarnDbm: v })}
                            />
                            <NumericField
                                label="Max Wind Gust"
                                hint="Alert if estimated wind gusts exceed this speed."
                                value={thresholds.windGustMph}
                                min={10} max={60} step={1} unit="mph"
                                onChange={v => updateThresholds({ windGustMph: v })}
                            />
                        </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        <p style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semi)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Atmospheric Pressure
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                            <NumericField
                                label="Pressure Drop Alert"
                                hint="Alert if pressure drops more than this amount over 3 hours."
                                value={thresholds.pressureDropMb}
                                min={1} max={15} step={0.5} unit="mb / 3 hr"
                                onChange={v => updateThresholds({ pressureDropMb: v })}
                            />
                            <NumericField
                                label="Low Pressure Threshold"
                                hint="Alert is only active when current pressure is below this value."
                                value={thresholds.pressureThreshMb}
                                min={970} max={1025} step={1} unit="mb"
                                onChange={v => updateThresholds({ pressureThreshMb: v })}
                            />
                        </div>
                    </div>

                    {/* Threshold Summary Table */}
                    <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                            <thead>
                                <tr style={{ background: 'var(--color-bg-panel)' }}>
                                    {['Condition', 'Threshold', 'Action'].map(h => (
                                        <th key={h} style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-medium)' }}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    { cond: 'Battery', val: `< ${thresholds.batteryWarnPct}%`, action: 'Alert', color: 'var(--color-warning)' },
                                    { cond: 'Battery', val: `< ${thresholds.batteryCritPct}%`, action: 'Auto-deflate', color: 'var(--color-danger)' },
                                    { cond: 'Signal', val: `< ${thresholds.signalWarnDbm} dBm`, action: 'Alert', color: 'var(--color-warning)' },
                                    { cond: 'Wind Gust', val: `> ${thresholds.windGustMph} mph`, action: 'Alert', color: 'var(--color-warning)' },
                                    { cond: 'Pressure Drop', val: `> ${thresholds.pressureDropMb} mb / 3 hr`, action: 'Alert', color: 'var(--color-warning)' },
                                    { cond: 'Geofence', val: 'Boundary breach', action: 'Auto-deflate', color: 'var(--color-danger)' },
                                    { cond: 'Altitude', val: `> ${geofence.maxAltitude} ft`, action: 'Auto-deflate', color: 'var(--color-danger)' },
                                ].map((row, i) => (
                                    <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-secondary)' }}>{row.cond}</td>
                                        <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-primary)' }}>{row.val}</td>
                                        <td style={{ padding: 'var(--space-2) var(--space-3)', color: row.color, fontWeight: 'var(--font-semi)' }}>{row.action}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Tab: Operator Profile ── */}
            {activeTab === 'operator' && (
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                    <SectionHeader
                        title="Operator Profile"
                        subtitle="Metadata attached to this flight session and included in exported flight logs."
                    />

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                        <Field label="Operator Name" hint="Appears in flight log exports.">
                            <input
                                className="input"
                                type="text"
                                placeholder="e.g. Jane Smith"
                                value={operator.name}
                                onChange={e => updateOperator({ name: e.target.value })}
                            />
                        </Field>
                        <Field label="Site Name" hint="Launch site identifier for this session.">
                            <input
                                className="input"
                                type="text"
                                placeholder="e.g. Desert Test Site A"
                                value={operator.siteName}
                                onChange={e => updateOperator({ siteName: e.target.value })}
                            />
                        </Field>
                    </div>

                    <Field label="Pre-Flight Notes" hint="Optional notes logged with this session (hazards, weather observations, etc.).">
                        <textarea
                            className="input"
                            rows={4}
                            placeholder="e.g. Light easterly breeze ~8 mph. Site clear of obstructions within 300 ft."
                            value={operator.notes}
                            onChange={e => updateOperator({ notes: e.target.value })}
                            style={{ resize: 'vertical', fontFamily: 'var(--font-sans)' }}
                        />
                    </Field>

                    {/* Site checklist */}
                    <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: 'var(--space-4)' }}>
                        <p style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semi)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-3)' }}>
                            Pre-Launch Checklist
                        </p>
                        {[
                            'Site is ≥ 5 miles from the nearest airport',
                            'Site is not on restricted public property',
                            'Max altitude set to ≤ 20 ft AGL',
                            'GNSS signal confirmed (±20 ft accuracy)',
                            'Radio communication link verified',
                            'Geofence boundaries configured and confirmed',
                            'Battery level > 20% before launch',
                            'Weather conditions within safe limits',
                        ].map((item, i) => (
                            <ChecklistItem key={i} label={item} />
                        ))}
                    </div>
                </div>
            )}

            {/* Save / Reset */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={handleReset}>Reset to Defaults</button>
                <button className="btn btn-primary" onClick={handleSave}>Save Settings</button>
            </div>

        </div>
    );
}

function ChecklistItem({ label }: { label: string }) {
    const [checked, setChecked] = useState(false);
    return (
        <div
            onClick={() => setChecked(v => !v)}
            style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-1)',
                borderBottom: '1px solid var(--color-border)',
                cursor: 'pointer', userSelect: 'none',
            }}
        >
            <div style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                border: `2px solid ${checked ? 'var(--color-success)' : 'var(--color-border)'}`,
                background: checked ? 'var(--color-success)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all var(--transition-fast)',
            }}>
                {checked && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
            </div>
            <span style={{
                fontSize: 'var(--text-sm)',
                color: checked ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                textDecoration: checked ? 'line-through' : 'none',
            }}>
                {label}
            </span>
        </div>
    );
}