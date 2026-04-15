// ============================================================
//  utils/api.js — Centralized API calls to the backend
// ============================================================

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export const requestOTP = (userId) =>
  apiFetch('/otp/request', { method: 'POST', body: JSON.stringify({ userId }) });

export const verifyOTP = (userId, otp) =>
  apiFetch('/otp/verify', { method: 'POST', body: JSON.stringify({ userId, otp }) });

export const getAuditTrail = (userId, token) =>
  apiFetch(`/audit/${userId}`, { headers: { Authorization: `Bearer ${token}` } });

export const getProfile = (token) =>
  apiFetch('/auth/profile', { headers: { Authorization: `Bearer ${token}` } });
