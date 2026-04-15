// ============================================================
//  pages/OTPPage.jsx — 6-digit OTP entry with auto-advance
// ============================================================
import { useState, useRef, useEffect } from 'react';
import { verifyOTP, requestOTP } from '../utils/api';

const OTP_LENGTH = 6;

export default function OTPPage({ userId, onSuccess }) {
  const [digits,    setDigits]    = useState(Array(OTP_LENGTH).fill(''));
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [resendCD,  setResendCD]  = useState(60);   // 60s cooldown
  const [timer,     setTimer]     = useState(300);  // 5min expiry
  const inputRefs = useRef([]);

  // Focus first box on mount
  useEffect(() => { inputRefs.current[0]?.focus(); }, []);

  // Countdown timers
  useEffect(() => {
    const id = setInterval(() => {
      setResendCD(p => Math.max(0, p - 1));
      setTimer(p => Math.max(0, p - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const otpValue = digits.join('');

  function handleChange(index, value) {
    if (!/^\d*$/.test(value)) return;        // digits only
    const next = [...digits];
    next[index] = value.slice(-1);           // one digit per box
    setDigits(next);
    setError('');
    if (value && index < OTP_LENGTH - 1) {   // auto-advance
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index, e) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus(); // go back on delete
    }
    if (e.key === 'Enter' && otpValue.length === OTP_LENGTH) {
      handleVerify();
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    const next = Array(OTP_LENGTH).fill('');
    pasted.split('').forEach((ch, i) => { next[i] = ch; });
    setDigits(next);
    inputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
  }

  async function handleVerify() {
    if (otpValue.length !== OTP_LENGTH) return;
    setLoading(true);
    setError('');
    try {
      const { token } = await verifyOTP(userId, otpValue);
      onSuccess(token);
    } catch (err) {
      setError(err.message || 'Invalid OTP. Please try again.');
      setDigits(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCD > 0) return;
    try {
      await requestOTP(userId);
      setResendCD(60);
      setTimer(300);
      setDigits(Array(OTP_LENGTH).fill(''));
      setError('');
      inputRefs.current[0]?.focus();
    } catch (err) {
      setError('Failed to resend OTP');
    }
  }

  const timerColor = timer < 60 ? '#e74c3c' : timer < 120 ? '#f39c12' : '#27ae60';
  const minutes    = String(Math.floor(timer / 60)).padStart(2, '0');
  const seconds    = String(timer % 60).padStart(2, '0');

  return (
    <div className="auth-page">
      <div className="auth-card otp-card">
        <div className="auth-logo">
          <span className="logo-icon">🔐</span>
          <h1>Verify OTP</h1>
          <p>Sent to <strong>{userId}</strong></p>
        </div>

        {/* Timer */}
        <div className="otp-timer" style={{ color: timerColor }}>
          {timer > 0 ? `Expires in ${minutes}:${seconds}` : 'OTP expired — please resend'}
        </div>

        {/* 6-box OTP input */}
        <div className="otp-boxes" onPaste={handlePaste}>
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={el => inputRefs.current[i] = el}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className={`otp-box ${digit ? 'filled' : ''} ${error ? 'error' : ''}`}
              disabled={loading || timer === 0}
              aria-label={`OTP digit ${i + 1}`}
            />
          ))}
        </div>

        {error && <div className="error-msg">{error}</div>}

        <button
          className="btn-primary"
          onClick={handleVerify}
          disabled={otpValue.length !== OTP_LENGTH || loading || timer === 0}
        >
          {loading ? <span className="spinner" /> : 'Verify OTP'}
        </button>

        {/* Blockchain verification badge */}
        <div className="chain-badge">
          <span>⛓</span>
          <span>Verified on Hyperledger Fabric</span>
        </div>

        <button
          className="btn-link"
          onClick={handleResend}
          disabled={resendCD > 0}
        >
          {resendCD > 0 ? `Resend in ${resendCD}s` : 'Resend OTP'}
        </button>
      </div>
    </div>
  );
}
