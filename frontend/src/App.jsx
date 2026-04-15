// ============================================================
//  App.jsx — Root React component with routing
// ============================================================
import { useState, createContext, useContext } from 'react';
import LoginPage   from './pages/LoginPage';
import OTPPage     from './pages/OTPPage';
import Dashboard   from './pages/Dashboard';

// Auth context — shared across all components
export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [step, setStep]       = useState('login');     // login | otp | dashboard
  const [userId, setUserId]   = useState('');
  const [token, setToken]     = useState(localStorage.getItem('otp_token'));

  function onLoginSuccess(uid) {
    setUserId(uid);
    setStep('otp');
  }

  function onOTPSuccess(jwt) {
    localStorage.setItem('otp_token', jwt);
    setToken(jwt);
    setStep('dashboard');
  }

  function logout() {
    localStorage.removeItem('otp_token');
    setToken(null);
    setUserId('');
    setStep('login');
  }

  return (
    <AuthContext.Provider value={{ userId, token, logout }}>
      <div className="app-root">
        {step === 'login'     && <LoginPage   onSuccess={onLoginSuccess} />}
        {step === 'otp'       && <OTPPage     userId={userId} onSuccess={onOTPSuccess} />}
        {step === 'dashboard' && <Dashboard   />}
      </div>
    </AuthContext.Provider>
  );
}
