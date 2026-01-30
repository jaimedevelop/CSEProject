import React from 'react';

const ForgotPassword: React.FC = () => {
    return (
        <div className="forgot-password-page">
            <h1>Forgot Password</h1>
            <form>
                <input type="email" placeholder="Email" />
                <button type="submit">Reset Password</button>
            </form>
        </div>
    );
};

export default ForgotPassword;
