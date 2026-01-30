import React from 'react';

const NavigationBar: React.FC = () => {
    return (
        <nav className="navigation-bar">
            <ul>
                <li><button>Home</button></li>
                <li><button>Map</button></li>
                <li><button>User Settings</button></li>
            </ul>
        </nav>
    );
};

export default NavigationBar;
