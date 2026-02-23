import React from 'react';
import NavigationBar from './NavigationBar';
import '../styles/theme.css';

interface LayoutProps {
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    return (
        <div className="app-layout">
            <NavigationBar />
            <main className="page-content">
                {children}
            </main>
        </div>
    );
};

export default Layout;