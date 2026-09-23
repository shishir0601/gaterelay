const API_BASE = "/api";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getToken() {
  return localStorage.getItem("gaterelay_token");
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    // FastAPI's default error shape is {"detail": "..."} — our custom validation handler
    // (see backend/main.py) normalizes 422s to the same shape, so this is the one place
    // the frontend ever needs to unwrap an error message from.
    const message = body?.detail || `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body;
}

export const api = {
  register: (name, email, password) => request("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) }),
  login: (email, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request("/auth/me"),

  listTrips: () => request("/trips"),
  createTrip: (payload) => request("/trips", { method: "POST", body: JSON.stringify(payload) }),
  getTrip: (id) => request(`/trips/${id}`),
  deleteTrip: (id) => request(`/trips/${id}`, { method: "DELETE" }),

  listRequests: () => request("/requests"),
  createRequest: (payload) => request("/requests", { method: "POST", body: JSON.stringify(payload) }),
  getRequest: (id) => request(`/requests/${id}`),
  deleteRequest: (id) => request(`/requests/${id}`, { method: "DELETE" }),

  getMatches: (requestId) => request(`/matches/${requestId}`),
  acceptMatch: (matchId) => request(`/matches/${matchId}/accept`, { method: "POST" }),

  getHandoff: (id) => request(`/handoffs/${id}`),
  listHandoffs: () => request("/handoffs"),
  generateOtp: (handoffId) => request(`/handoffs/${handoffId}/generate-otp`, { method: "POST" }),
  verifyOtp: (handoffId, code) => request(`/handoffs/${handoffId}/verify-otp`, { method: "POST", body: JSON.stringify({ code }) }),
};
