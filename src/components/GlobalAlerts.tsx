import { useCallback, useEffect, useState } from 'react';
import { fetchLatestTelemetry, type TelemetryPacket } from '../services/telemetry';

interface Alert {
    id: string;
    level: 'warning' | 'danger' | 'info';
    message: string;
}

function fmt(val: number | null | undefined, decimals = 1): string {
    if (val == null) return '--';
    return val.toFixed(decimals);
}

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

function deriveGlobalAlerts(d: TelemetryPacket): Alert[] {
    const alerts: Alert[] = [];

    if (d.det) {
        alerts.push({
            id: 'det-fired',
            level: 'danger',
            message: `Detonation reported: ${detReasonLabel(d)}`,
        });
    }

    if (d.pressure_drop_warning) {
        alerts.push({
            id: 'pres-drop-warn',
            level: 'warning',
            message: `Pressure drop warning: ${fmt(d.pressure_drop_3h_mb ?? null, 1)} mb over 3h and current pressure ${d.pressure_hpa.toFixed(1)} mb (<1009 mb).`,
        });
    }

    if (d.calculated_wind_gust_mph != null && d.calculated_wind_gust_mph > 40) {
        alerts.push({
            id: 'wind-warn',
            level: 'danger',
            message: `Calculated wind gust exceeds 40 mph (${d.calculated_wind_gust_mph.toFixed(1)} mph).`,
        });
    }

    return alerts;
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

export default function GlobalAlerts() {
    const [alerts, setAlerts] = useState<Alert[]>([]);

    const poll = useCallback(async () => {
        const result = await fetchLatestTelemetry();
        if (result.status === 'ok') {
            setAlerts(deriveGlobalAlerts(result.data));
        } else {
            setAlerts([]);
        }
    }, []);

    useEffect(() => {
        void poll();
        const interval = setInterval(() => {
            void poll();
        }, 1000);
        return () => clearInterval(interval);
    }, [poll]);

    if (alerts.length === 0) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            {alerts.map(a => <AlertBanner key={a.id} alert={a} />)}
        </div>
    );
}
