// ============================================================
//  pages/Dashboard.jsx — Authenticated user dashboard
// ============================================================
import { useState, useEffect } from 'react';
import { useAuth } from '../App';
import { getAuditTrail, getProfile } from '../utils/api';

export default function Dashboard() {
  const { userId, logout, token } = useAuth();
  const [profile, setProfile]   = useState(null);
  const [audit,   setAudit]     = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [prof, trail] = await Promise.all([
          getProfile(token),
          getAuditTrail(userId, token),
        ]);
        setProfile(prof.user);
        setAudit(trail.events || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const eventColors = {
    REQUEST        : '#3498db',
    VERIFY_SUCCESS : '#27ae60',
    VERIFY_FAIL    : '#e74c3c',
  };

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-brand">
          <span>⛓</span> BlockOTP Dashboard
        </div>
        <div className="dash-user">
          <span>{userId}</span>
          <button className="btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="dash-main">
        {/* Status cards */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#e8f4fd' }}>🔒</div>
            <div>
              <div className="stat-value">Authenticated</div>
              <div className="stat-label">Session Status</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#eafaf1' }}>⛓</div>
            <div>
              <div className="stat-value">Fabric Active</div>
              <div className="stat-label">Blockchain Network</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#fef9e7' }}>📋</div>
            <div>
              <div className="stat-value">{audit.length}</div>
              <div className="stat-label">Audit Events</div>
            </div>
          </div>
        </div>

        {/* Audit Trail */}
        <section className="audit-section">
          <h2>Blockchain Audit Trail</h2>
          <p className="audit-desc">
            Every OTP event is permanently recorded on the Hyperledger Fabric ledger.
            These records cannot be altered or deleted.
          </p>

          {loading ? (
            <div className="loading">Loading blockchain data...</div>
          ) : audit.length === 0 ? (
            <div className="empty">No audit events yet</div>
          ) : (
            <div className="audit-list">
              {audit.map((event, i) => (
                <div key={i} className="audit-item">
                  <div
                    className="audit-badge"
                    style={{ background: eventColors[event.eventType] || '#95a5a6' }}
                  >
                    {event.eventType}
                  </div>
                  <div className="audit-details">
                    <div className="audit-tx">TX: {event.txId?.slice(0, 24)}...</div>
                    <div className="audit-time">
                      {new Date(event.timestamp * 1000).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
