import React from 'react';
import NavigationBar from './NavigationBar';

interface LayoutProps {
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    return (
        <div className="app-layout mobile-friendly">
            <main className="content">
                {children}
            </main>
            <NavigationBar />
        </div>
    );
};

export default Layout;
