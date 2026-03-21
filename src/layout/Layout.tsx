import React from 'react';
import NavigationBar from './NavigationBar';
import GlobalAlerts from '../components/GlobalAlerts';
import '../styles/theme.css';

interface LayoutProps {
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    return (
        <div className="app-layout">
            <NavigationBar />
            <main className="page-content">
                <GlobalAlerts />
                {children}
            </main>
        </div>
    );
};

export default Layout;