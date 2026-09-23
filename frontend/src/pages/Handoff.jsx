import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { formatDateTime } from "../lib/format.js";

const STEPS = ["Match confirmed", "Ready for handoff", "Delivery complete"];

export default function Handoff() {
  const { handoffId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [handoff, setHandoff] = useState(null);
  const [error, setError] = useState(null);
  const [otp, setOtp] = useState(null); // the freshly-generated plaintext code, held only in memory, only on the traveler's screen
  const [codeInput, setCodeInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const h = await api.getHandoff(handoffId);
      setHandoff(h);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this handoff.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffId]);

  if (error) {
    return (
      <div>
        <div className="alert alert-error">{error}</div>
        <button className="btn btn-secondary" onClick={() => navigate("/dashboard")}>
          <ArrowLeft size={14} /> Back to dashboard
        </button>
      </div>
    );
  }

  if (!handoff) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="skeleton" />
      </div>
    );
  }

  const isTraveler = handoff.trip.user_id === user.id;
  const isRequester = handoff.request.user_id === user.id;
  const hasLiveCode = handoff.otp_expires_at && new Date(`${handoff.otp_expires_at}Z`) > new Date();
  const stepIndex = handoff.status === "COMPLETED" ? 2 : hasLiveCode || otp ? 1 : 0;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.generateOtp(handoffId);
      setOtp(res.code);
      // A real bug found during review: this used to call load() again here to refresh
      // otp_expires_at -- an entirely unnecessary extra network round-trip, since
      // generateOtp's own response already contains expires_at. Worse, if that redundant
      // refresh failed (a transient network blip), its error overwrote this success with
      // "Could not generate a code" even though a code WAS generated and was already
      // visible on screen. Updating local state directly fixes both problems at once.
      setHandoff((prev) => ({ ...prev, otp_expires_at: res.expires_at }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate a code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.verifyOtp(handoffId, codeInput);
      setHandoff(updated);
      setCodeInput("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify this code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <button className="btn btn-secondary" onClick={() => navigate("/dashboard")} style={{ marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to dashboard
      </button>

      <div className="card">
        <div className="route-line">
          {handoff.trip.origin} <ArrowRight size={14} className="route-arrow" /> {handoff.trip.destination}
        </div>
        <div className="page-subtitle mono" style={{ marginTop: 4 }}>
          {formatDateTime(handoff.trip.departure_time)}
        </div>
        <div className="page-subtitle" style={{ marginTop: 2 }}>
          Traveler: {handoff.trip.owner_name} · Requester: {handoff.request.owner_name}
        </div>

        <div className="handoff-steps">
          {STEPS.map((_, i) => (
            <div key={i} className={`handoff-step${i < stepIndex ? " done" : i === stepIndex ? " current" : ""}`} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--text-faint)", marginBottom: 18 }}>
          {STEPS.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {handoff.status === "COMPLETED" ? (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <CheckCircle2 size={36} color="var(--success)" style={{ marginBottom: 8 }} />
            <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>Delivery complete</div>
            <div className="page-subtitle mono" style={{ marginTop: 4 }}>
              Confirmed {formatDateTime(handoff.completed_at)}
            </div>
          </div>
        ) : isTraveler ? (
          <TravelerPanel otp={otp} handoff={handoff} busy={busy} onGenerate={generate} />
        ) : isRequester ? (
          <RequesterPanel hasLiveCode={hasLiveCode} codeInput={codeInput} setCodeInput={setCodeInput} busy={busy} onVerify={verify} />
        ) : null}
      </div>
    </div>
  );
}

function TravelerPanel({ otp, handoff, busy, onGenerate }) {
  return (
    <div>
      {otp ? (
        <>
          <div className="field-hint" style={{ marginBottom: 4 }}>
            Share this code with the requester in person to confirm the handoff:
          </div>
          <div className="otp-code">{otp}</div>
          <div className="field-hint">Expires {formatDateTime(handoff.otp_expires_at)}. You can generate a new code if it expires.</div>
        </>
      ) : (
        <>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 14 }}>
            Generate a handoff code and share it with the requester when you hand over the item.
          </p>
          <button className="btn btn-primary btn-block" onClick={onGenerate} disabled={busy}>
            {busy ? <span className="spinner" /> : "Generate code"}
          </button>
        </>
      )}
    </div>
  );
}

function RequesterPanel({ hasLiveCode, codeInput, setCodeInput, busy, onVerify }) {
  if (!hasLiveCode) {
    return <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Waiting for the traveler to generate a handoff code.</p>;
  }
  return (
    <form onSubmit={onVerify}>
      <div className="field">
        <label htmlFor="code">Enter the 6-digit code from the traveler</label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          className="otp-input"
          maxLength={6}
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ""))}
          required
        />
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || codeInput.length !== 6}>
        {busy ? <span className="spinner" /> : "Verify and complete"}
      </button>
    </form>
  );
}
