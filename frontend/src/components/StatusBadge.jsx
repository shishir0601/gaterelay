const CLASS_MAP = {
  ACTIVE: "badge-active",
  OPEN: "badge-open",
  MATCHED: "badge-matched",
  PENDING: "badge-pending",
  VERIFIED: "badge-pending",
  COMPLETED: "badge-completed",
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${CLASS_MAP[status] ?? "badge-completed"}`}>{status}</span>;
}
