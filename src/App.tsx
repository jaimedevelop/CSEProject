import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './layout/Layout';
import Dashboard from './pages/dashboard/Dashboard';
import Map from './pages/map/Map';
import FlightLogs from './pages/flightLogs/FlightLogs';
import UserSettings from './pages/userSettings/UserSettings';

function App() {
    return (
        <BrowserRouter>
            <Layout>
                <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/map" element={<Map />} />
                    <Route path="/flightlogs" element={<FlightLogs />} />
                    <Route path="/usersettings" element={<UserSettings />} />
                </Routes>
            </Layout>
        </BrowserRouter>
    );
}

export default App;