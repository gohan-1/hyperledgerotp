// ============================================================
//  pages/LoginPage.jsx — Enter userId, trigger OTP send
// ============================================================
import { useState } from 'react';
import { requestOTP } from '../utils/api';

export default function LoginPage({ onSuccess }) {
  const [userId,  setUserId]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userId.trim()) return;
    setLoading(true);
    setError('');
    try {
      await requestOTP(userId.trim());
      onSuccess(userId.trim());
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="logo-icon">⛓</span>
          <h1>BlockOTP</h1>
          <p>Blockchain-secured authentication</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label htmlFor="userId">User ID</label>
          <input
            id="userId"
            type="text"
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder="Enter your user ID"
            autoComplete="username"
            disabled={loading}
            required
          />

          {error && <div className="error-msg">{error}</div>}

          <button type="submit" className="btn-primary" disabled={loading || !userId.trim()}>
            {loading ? <span className="spinner" /> : 'Send OTP →'}
          </button>
        </form>

        <p className="auth-note">
          OTP is stored on a private blockchain — no SMS required.
        </p>
      </div>
    </div>
  );
}
