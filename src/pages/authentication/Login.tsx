import React from 'react';

const Login: React.FC = () => {
    return (
        <div className="login-page">
            <h1>Login</h1>
            <form>
                <input type="email" placeholder="Email" />
                <input type="password" placeholder="Password" />
                <button type="submit">Login</button>
            </form>
        </div>
    );
};

export default Login;
