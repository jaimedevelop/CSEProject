import React from 'react';
import { NavLink } from 'react-router-dom';
import '../styles/theme.css';

interface NavItem {
    to: string;
    icon: string;
    label: string;
}

const NAV_ITEMS: NavItem[] = [
    { to: '/', icon: '📡', label: 'Dashboard' },
    { to: '/map', icon: '🗺️', label: 'Map' },
    { to: '/flightlogs', icon: '📋', label: 'Flight Logs' },
];

const NavigationBar: React.FC = () => {
    return (
        <nav className="sidebar">

            {/* Brand */}
            <div style={{
                padding: 'var(--space-4) var(--space-4) var(--space-2)',
                borderBottom: '1px solid var(--color-border)',
                marginBottom: 'var(--space-2)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontSize: '1.25rem' }}>🎈</span>
                    <div>
                        <div style={{ fontWeight: 'var(--font-semi)', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                            BalloonOps
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                            Ground Control
                        </div>
                    </div>
                </div>
            </div>

            {/* Nav links */}
            <ul style={{ listStyle: 'none', padding: 'var(--space-2)', flex: 1 }}>
                {NAV_ITEMS.map(({ to, icon, label }) => (
                    <li key={to}>
                        <NavLink
                            to={to}
                            end={to === '/'}
                            style={({ isActive }) => ({
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-3)',
                                padding: 'var(--space-2) var(--space-3)',
                                borderRadius: 'var(--radius-md)',
                                marginBottom: 'var(--space-1)',
                                textDecoration: 'none',
                                fontSize: 'var(--text-sm)',
                                fontWeight: isActive ? 'var(--font-semi)' : 'var(--font-normal)',
                                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                background: isActive ? 'var(--color-bg-card)' : 'transparent',
                                borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                                transition: 'all var(--transition-fast)',
                            })}
                        >
                            <span style={{ fontSize: '1rem', width: 20, textAlign: 'center' }}>{icon}</span>
                            {label}
                        </NavLink>
                    </li>
                ))}
            </ul>

            {/* Footer status */}
            <div style={{
                padding: 'var(--space-3) var(--space-4)',
                borderTop: '1px solid var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
            }}>
                <span className="live-dot" />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    Telemetry live
                </span>
            </div>

        </nav>
    );
};

export default NavigationBar;