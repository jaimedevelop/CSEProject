import React from 'react';

const SignUp: React.FC = () => {
    return (
        <div className="signup-page">
            <h1>Sign Up</h1>
            <form>
                <input type="text" placeholder="Full Name" />
                <input type="email" placeholder="Email" />
                <input type="password" placeholder="Password" />
                <button type="submit">Sign Up</button>
            </form>
        </div>
    );
};

export default SignUp;
