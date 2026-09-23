import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Send, PackageSearch, ArrowRight } from "lucide-react";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatDateTime, ITEM_SIZE_LABELS } from "../lib/format.js";

export default function Dashboard() {
  const { user } = useAuth();
  const [trips, setTrips] = useState(null);
  const [requests, setRequests] = useState(null);
  const [handoffs, setHandoffs] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    try {
      const [t, r, h] = await Promise.all([api.listTrips(), api.listRequests(), api.listHandoffs()]);
      setTrips(t);
      setRequests(r);
      setHandoffs(h);
    } catch (err) {
      // A real gap found during review: this previously had no error handling at all --
      // any API failure (expired token, network error) left the page stuck on the loading
      // skeleton forever, with a silently swallowed promise rejection in the console.
      setError(err instanceof ApiError ? err.message : "Could not load your dashboard. Please try again.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handoffFor(kind, id) {
    if (!handoffs) return null;
    return handoffs.find((h) => (kind === "trip" ? h.trip_id === id : h.request_id === id));
  }

  async function handleDeleteTrip(id) {
    if (!window.confirm("Cancel this trip? This can't be undone.")) return;
    setBusyId(id);
    setError(null);
    try {
      await api.deleteTrip(id);
      await load();
    } catch (err) {
      // Same gap as load() above: a failed delete (e.g. the trip's state changed
      // underneath the user) previously had no way to tell the user anything went wrong.
      setError(err instanceof ApiError ? err.message : "Could not cancel this trip. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteRequest(id) {
    if (!window.confirm("Cancel this pickup request? This can't be undone.")) return;
    setBusyId(id);
    setError(null);
    try {
      await api.deleteRequest(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel this request. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  const loading = trips === null || requests === null || handoffs === null;
  const activeHandoffs = handoffs?.filter((h) => h.status !== "COMPLETED") ?? [];

  return (
    <div>
      <div className="topbar">
        <div>
          <h1 className="page-title">Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}</h1>
          <p className="page-subtitle">Here's what's happening with your trips and requests.</p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>{error}</span>
          {loading && (
            <button className="btn btn-secondary" onClick={load} style={{ flexShrink: 0 }}>
              Retry
            </button>
          )}
        </div>
      )}

      {loading && !error ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : loading ? null : (
        <>
          <div className="card-grid" style={{ marginBottom: 28 }}>
            <StatCard label="Active trips" value={trips.filter((t) => t.status === "ACTIVE").length} />
            <StatCard label="Open requests" value={requests.filter((r) => r.status === "OPEN").length} />
            <StatCard label="Handoffs in progress" value={activeHandoffs.length} />
          </div>

          <Section title="Your trips" empty={trips.length === 0} emptyText="You haven't posted a trip yet.">
            {trips.map((trip) => (
              <div key={trip.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div className="route-line">
                      {trip.origin} <ArrowRight size={14} className="route-arrow" /> {trip.destination}
                    </div>
                    <div className="page-subtitle mono" style={{ marginTop: 4 }}>
                      {formatDateTime(trip.departure_time)} · capacity {trip.available_capacity}
                    </div>
                  </div>
                  <StatusBadge status={trip.status} />
                </div>
                <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                  {trip.status === "ACTIVE" && (
                    <button className="btn-danger-text" onClick={() => handleDeleteTrip(trip.id)} disabled={busyId === trip.id}>
                      Cancel trip
                    </button>
                  )}
                  {handoffFor("trip", trip.id) && (
                    <Link to={`/handoffs/${handoffFor("trip", trip.id).id}`} className="btn btn-secondary">
                      View handoff
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </Section>

          <Section title="Your pickup requests" empty={requests.length === 0} emptyText="You haven't posted a pickup request yet.">
            {requests.map((req) => (
              <div key={req.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div className="route-line">
                      {req.pickup_location} <ArrowRight size={14} className="route-arrow" /> {req.delivery_location}
                    </div>
                    <div className="page-subtitle mono" style={{ marginTop: 4 }}>
                      {formatDateTime(req.earliest_time)} – {formatDateTime(req.latest_time)} · {ITEM_SIZE_LABELS[req.item_size]}
                    </div>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
                <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                  {req.status === "OPEN" && (
                    <>
                      <Link to={`/requests/${req.id}/matches`} className="btn btn-primary">
                        Find matches
                      </Link>
                      <button className="btn-danger-text" onClick={() => handleDeleteRequest(req.id)} disabled={busyId === req.id}>
                        Cancel request
                      </button>
                    </>
                  )}
                  {handoffFor("request", req.id) && (
                    <Link to={`/handoffs/${handoffFor("request", req.id).id}`} className="btn btn-secondary">
                      View handoff
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </Section>

          <Section title="Handoffs" empty={handoffs.length === 0} emptyText="No handoffs yet — they'll show up here once you accept a match.">
            {handoffs.slice(0, 5).map((h) => (
              <div key={h.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="mono" style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                  Handoff #{h.id.slice(0, 8)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <StatusBadge status={h.status} />
                  <Link to={`/handoffs/${h.id}`} className="btn btn-secondary">
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </Section>

          {trips.length === 0 && requests.length === 0 && (
            <div className="card-grid" style={{ marginTop: 8 }}>
              <QuickAction to="/trips/new" icon={<Send size={18} />} label="Post a Trip" />
              <QuickAction to="/requests/new" icon={<PackageSearch size={18} />} label="Request a Pickup" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card">
      <div className="mono" style={{ fontSize: "1.8rem", fontWeight: 600, color: "var(--accent)" }}>
        {value}
      </div>
      <div className="page-subtitle">{label}</div>
    </div>
  );
}

function QuickAction({ to, icon, label }) {
  return (
    <Link to={to} className="card" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "inherit" }}>
      <span style={{ color: "var(--accent)" }}>{icon}</span>
      <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{label}</span>
    </Link>
  );
}

function Section({ title, empty, emptyText, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: "1rem", marginBottom: 10 }}>{title}</h2>
      {empty ? (
        <div className="empty-state card">
          <div className="empty-state-title">Nothing here yet</div>
          <div>{emptyText}</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>{children}</div>
      )}
    </div>
  );
}
