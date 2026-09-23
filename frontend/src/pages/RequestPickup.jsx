import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import { toApiDateTime } from "../lib/format.js";

export default function RequestPickup() {
  const navigate = useNavigate();
  const [pickup, setPickup] = useState("");
  const [delivery, setDelivery] = useState("");
  const [earliest, setEarliest] = useState("");
  const [latest, setLatest] = useState("");
  const [itemSize, setItemSize] = useState("MEDIUM");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    // Same idea as PostTrip's origin/destination check -- catches the backend's
    // latest-after-earliest rule before a round-trip, not just after one.
    if (latest && earliest && new Date(latest) <= new Date(earliest)) {
      setError("Latest acceptable time must be after earliest acceptable time");
      return;
    }
    setLoading(true);
    try {
      const created = await api.createRequest({
        pickup_location: pickup.trim(),
        delivery_location: delivery.trim(),
        earliest_time: toApiDateTime(earliest),
        latest_time: toApiDateTime(latest),
        item_size: itemSize,
      });
      navigate(`/requests/${created.id}/matches`);
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
          <h1 className="page-title">Request a Pickup</h1>
          <p className="page-subtitle">Tell travelers what you need moved, and when.</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="card">
        <div className="form-row">
          <div className="field">
            <label htmlFor="pickup">Pickup location</label>
            <input id="pickup" type="text" placeholder="Hyderabad" value={pickup} onChange={(e) => setPickup(e.target.value)} required maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="delivery">Delivery location</label>
            <input id="delivery" type="text" placeholder="Warangal" value={delivery} onChange={(e) => setDelivery(e.target.value)} required maxLength={100} />
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="earliest">Earliest acceptable time</label>
            <input id="earliest" type="datetime-local" value={earliest} onChange={(e) => setEarliest(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="latest">Latest acceptable time</label>
            <input id="latest" type="datetime-local" value={latest} onChange={(e) => setLatest(e.target.value)} required />
          </div>
        </div>

        <div className="field">
          <label htmlFor="itemSize">Item size</label>
          <select id="itemSize" value={itemSize} onChange={(e) => setItemSize(e.target.value)}>
            <option value="SMALL">Small</option>
            <option value="MEDIUM">Medium</option>
            <option value="LARGE">Large</option>
          </select>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? <span className="spinner" /> : "Find matches"}
        </button>
      </form>
    </div>
  );
}
