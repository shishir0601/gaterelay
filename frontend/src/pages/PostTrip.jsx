import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import { toApiDateTime } from "../lib/format.js";

export default function PostTrip() {
  const navigate = useNavigate();
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [capacity, setCapacity] = useState(2);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    // Catches the same rule the backend enforces (TripCreate's destination-differs-from-
    // origin validator), but before a round-trip -- a cheap, real UX improvement found
    // during review: previously this only surfaced as a server error after submitting.
    if (origin.trim().toLowerCase() === destination.trim().toLowerCase()) {
      setError("Destination must be different from origin");
      return;
    }
    setLoading(true);
    try {
      await api.createTrip({
        origin: origin.trim(),
        destination: destination.trim(),
        departure_time: toApiDateTime(departureTime),
        available_capacity: Number(capacity),
      });
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Post a Trip</h1>
          <p className="page-subtitle">Let requesters know you're heading somewhere with room to spare.</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="card">
        <div className="form-row">
          <div className="field">
            <label htmlFor="origin">Origin</label>
            <input id="origin" type="text" placeholder="Hyderabad" value={origin} onChange={(e) => setOrigin(e.target.value)} required maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="destination">Destination</label>
            <input id="destination" type="text" placeholder="Warangal" value={destination} onChange={(e) => setDestination(e.target.value)} required maxLength={100} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="departure">Departure time</label>
          <input id="departure" type="datetime-local" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} required />
        </div>

        <div className="field">
          <label htmlFor="capacity">Available capacity</label>
          <select id="capacity" value={capacity} onChange={(e) => setCapacity(e.target.value)}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "unit" : "units"}
              </option>
            ))}
          </select>
          <div className="field-hint">How much room you have — a small item needs 1 unit, medium 2, large 3.</div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? <span className="spinner" /> : "Post trip"}
        </button>
      </form>
    </div>
  );
}
