import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { api, ApiError } from "../lib/api.js";
import { formatDateTime } from "../lib/format.js";

export default function Matches() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState(null);
  const [acceptingId, setAcceptingId] = useState(null);

  useEffect(() => {
    api
      .getMatches(requestId)
      .then(setMatches)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load matches."));
  }, [requestId]);

  async function accept(matchId) {
    setAcceptingId(matchId);
    setError(null);
    try {
      const result = await api.acceptMatch(matchId);
      navigate(`/handoffs/${result.handoff_id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept this match.");
      setAcceptingId(null);
      // a match that failed to accept (e.g. someone else took it first) is stale -- refresh
      api.getMatches(requestId).then(setMatches).catch(() => {});
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <button className="btn btn-secondary" onClick={() => navigate("/dashboard")} style={{ marginBottom: 12 }}>
            <ArrowLeft size={14} /> Back to dashboard
          </button>
          <h1 className="page-title">Matches</h1>
          <p className="page-subtitle">Ranked by a rule-based compatibility score -- not AI, just deterministic math you can check yourself.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {matches === null ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : matches.length === 0 ? (
        <div className="empty-state card">
          <div className="empty-state-title">No matches yet</div>
          <div>No compatible trips are posted right now. Check back later, or try posting your request with a wider time window.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {matches.map((m) => (
            <div key={m.match_id} className="card match-card">
              <div style={{ flex: 1 }}>
                <div className="route-line">
                  {m.trip.origin} <ArrowRight size={14} className="route-arrow" /> {m.trip.destination}
                </div>
                <div className="page-subtitle mono" style={{ marginTop: 4 }}>
                  Departs {formatDateTime(m.trip.departure_time)} · capacity {m.trip.available_capacity}
                </div>
                <div className="page-subtitle" style={{ marginTop: 2 }}>
                  Traveler: {m.trip.owner_name}
                </div>
                <div className="match-reasons">
                  {m.reasons.map((reason) => (
                    <span key={reason} className="match-reason-tag">
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
              <div className="match-card-actions">
                <div className="match-score">{m.score}%</div>
                <div className="match-score-label">compatible</div>
                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => accept(m.match_id)} disabled={acceptingId !== null}>
                  {acceptingId === m.match_id ? <span className="spinner" /> : "Accept"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
