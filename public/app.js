/* GateRelay frontend — vanilla JS, zero dependencies. */

const $ = (id) => document.getElementById(id);
let me = null;
let pollTimer = null;

// ---------- api ----------

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (me && me.sessionToken) headers.Authorization = `Bearer ${me.sessionToken}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && me) handleSessionExpired();
    throw new Error(data.error || "Request failed");
  }
  return data;
}

/** Session is gone server-side (or was never valid) — drop back to check-in. */
function handleSessionExpired() {
  me = null;
  clearInterval(pollTimer);
  ["trip-card", "request-card", "passes-card", "trips-card", "carrying-card", "board-card"].forEach((id) => ($(id).hidden = true));
  $("identity-info").hidden = true;
  $("identity-setup").hidden = false;
  toast("Your session ended — check in again to continue.", "error");
}

/** Disables a button for the duration of an async action, so a slow tap can't double-submit. */
async function withBusy(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } finally {
    button.disabled = false;
  }
}

const minsFromNow = (m) => new Date(Date.now() + m * 60_000).toISOString();
const fmtTime = (epochMs) => new Date(epochMs).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const typeLabel = (r) => (r.type === "food" ? "Food" : "Parcel");

/** "in 12 min" / "3 min ago" / "now" — friendlier than a bare clock time. */
function relativeTime(epochMs) {
  const diffMin = Math.round((epochMs - Date.now()) / 60_000);
  if (Math.abs(diffMin) < 1) return "now";
  if (diffMin > 0) return `in ${diffMin} min`;
  return `${Math.abs(diffMin)} min ago`;
}

const EMPTY_ICON = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V6a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v6"/><path d="M4 20h7"/><path d="M14 21l3-3 3 3"/><path d="M17 18v-6"/></svg>`;

/** Render a list into HTML, or an empty-state note if there's nothing. */
const renderList = (items, itemHtml, emptyNote) =>
  items.length ? items.map(itemHtml).join("") : `<p class="empty-note">${EMPTY_ICON}<span>${emptyNote}</span></p>`;

function emptyStateHtml(note) {
  return `<p class="empty-note">${EMPTY_ICON}<span>${note}</span></p>`;
}

function showLoadingSkeletons() {
  const loading = `<p class="empty-note skeleton-pulse"><span>Loading\u2026</span></p>`;
  ["board-trips", "board-requests", "passes-list", "carrying-list", "trips-list"].forEach((id) => {
    const el = $(id);
    el.innerHTML = loading;
    el.dataset.empty = "1";
  });
}

// ---------- split-flap value updates (signature motion) ----------

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setFlipValue(el, text) {
  const next = String(text);
  if (el.textContent === next) return;
  if (reduceMotion()) {
    el.textContent = next;
    return;
  }
  el.classList.add("flipping");
  setTimeout(() => { el.textContent = next; }, 150);
  setTimeout(() => { el.classList.remove("flipping"); }, 320);
}

// ---------- split-flap board (per-character) ----------

const FLAP_WIDTH = 30;

function padFlap(text) {
  const upper = text.toUpperCase();
  if (upper.length > FLAP_WIDTH) return upper.slice(0, FLAP_WIDTH - 1) + "\u2026";
  return upper.padEnd(FLAP_WIDTH, " ");
}

function buildFlapRow() {
  const row = document.createElement("div");
  row.className = "flap-row";

  const strip = document.createElement("div");
  strip.className = "flap-strip";
  strip.setAttribute("aria-hidden", "true");
  const tiles = [];
  for (let i = 0; i < FLAP_WIDTH; i++) {
    const tile = document.createElement("span");
    tile.className = "flap-char space";
    tile.textContent = " ";
    strip.appendChild(tile);
    tiles.push(tile);
  }

  const meta = document.createElement("div");
  meta.className = "flap-meta";
  const metaLeft = document.createElement("span");
  const metaRight = document.createElement("span");
  meta.appendChild(metaLeft);
  meta.appendChild(metaRight);

  row.appendChild(strip);
  row.appendChild(meta);
  row._tiles = tiles;
  row._metaLeft = metaLeft;
  row._metaRight = metaRight;
  return row;
}

/** Updates a flap row's tiles, animating only the characters that changed. */
function updateFlapRow(row, text, metaLeftText, metaRightHtml) {
  const padded = padFlap(text);
  const tiles = row._tiles;
  const skipMotion = reduceMotion();

  for (let i = 0; i < FLAP_WIDTH; i++) {
    const tile = tiles[i];
    const ch = padded[i];
    if (tile.textContent === ch) continue;
    tile.classList.toggle("space", ch === " ");
    if (skipMotion) {
      tile.textContent = ch;
      continue;
    }
    const delay = i * 9;
    setTimeout(() => {
      tile.classList.add("flipping");
      setTimeout(() => { tile.textContent = ch; }, 110);
      setTimeout(() => { tile.classList.remove("flipping"); }, 250);
    }, delay);
  }

  if (row._metaLeft.textContent !== metaLeftText) row._metaLeft.textContent = metaLeftText;
  if (row._metaRight.innerHTML !== metaRightHtml) row._metaRight.innerHTML = metaRightHtml;
}

/**
 * Keeps a flap-board container in sync with a list of items without
 * throwing away DOM nodes every poll — that's what lets updateFlapRow
 * animate only the characters that actually changed, instead of the
 * whole board re-flipping every 4 seconds.
 */
function syncFlapBoard(container, items, keyFn, lineFn, emptyNote) {
  if (items.length === 0) {
    container.innerHTML = emptyStateHtml(emptyNote);
    container.dataset.empty = "1";
    return;
  }
  if (container.dataset.empty === "1") {
    container.innerHTML = "";
    container.dataset.empty = "0";
  }

  const keys = new Set(items.map(keyFn));
  [...container.children].forEach((child) => {
    if (!keys.has(child.dataset.key)) child.remove();
  });

  items.forEach((item) => {
    const key = keyFn(item);
    let row = container.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!row) {
      row = buildFlapRow();
      row.dataset.key = key;
      container.appendChild(row);
    } else {
      container.appendChild(row); // re-append: keeps DOM order == items order
    }
    const { text, metaLeft, metaRight } = lineFn(item);
    updateFlapRow(row, text, metaLeft, metaRight);
  });
}

// ---------- gate clock ----------

function tickGateClock() {
  $("gate-clock-value").textContent = new Date().toLocaleTimeString("en-IN", { hour12: false });
}
tickGateClock();
setInterval(tickGateClock, 1000);

// ---------- setup ----------

$("register-btn").addEventListener("click", async () => {
  const name = $("my-name").value.trim();
  const collegeId = $("my-collegeid").value.trim();
  if (!name || !collegeId) return toast("Enter your name and college ID", "error");
  await withBusy($("register-btn"), async () => {
    try {
      me = await api("POST", "/api/members", { name, collegeId });
      $("identity-setup").hidden = true;
      $("identity-info").hidden = false;
      $("me-name").textContent = me.name;
      ["trip-card", "request-card", "passes-card", "trips-card", "carrying-card", "board-card"].forEach((id) => ($(id).hidden = false));
      $("rep-value").textContent = me.reputation;
      showLoadingSkeletons();
      startPolling();
    } catch (e) { toast(e.message, "error"); }
  });
});

function renderReputation() {
  setFlipValue($("rep-value"), me.reputation);
}

// ---------- posting ----------

$("post-trip").addEventListener("click", async (ev) => {
  const start = Number($("trip-start").value);
  const end = Number($("trip-end").value);
  const capacity = Number($("trip-capacity").value);
  if (!(end > start)) return toast("End time must be after start time", "error");
  if (!(capacity >= 1)) return toast("Capacity must be at least 1", "error");
  await withBusy(ev.currentTarget, async () => {
    try {
      await api("POST", "/api/trips", {
        direction: $("trip-direction").value,
        windowStart: minsFromNow(start), windowEnd: minsFromNow(end), capacity,
      });
      toast("Trip posted — matching requests will be assigned to you", "success");
      refresh();
    } catch (e) { toast(e.message, "error"); }
  });
});

$("post-request").addEventListener("click", async (ev) => {
  const description = $("req-desc").value.trim();
  const start = Number($("req-start").value);
  const end = Number($("req-end").value);
  if (!description) return toast("Describe what needs picking up", "error");
  if (!(end > start)) return toast("End time must be after start time", "error");
  await withBusy(ev.currentTarget, async () => {
    try {
      const request = await api("POST", "/api/requests", {
        description, type: $("req-type").value, valueTag: $("req-value").value,
        windowStart: minsFromNow(start), windowEnd: minsFromNow(end),
      });
      toast(request.status === "matched" ? "Request posted — matched to a trip already on the board" : "Request posted", "success");
      $("req-desc").value = "";
      refresh();
    } catch (e) { toast(e.message, "error"); }
  });
});

// ---------- board tabs ----------

document.querySelectorAll(".board-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".board-tab").forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    const isTrips = tab.dataset.tab === "trips";
    $("board-trips").hidden = !isTrips;
    $("board-requests").hidden = isTrips;
  });
});

// ---------- rendering ----------

async function refresh() {
  if (!me) return;
  try {
    const [trips, requests, myInfo] = await Promise.all([
      api("GET", "/api/trips"),
      api("GET", "/api/requests"),
      api("GET", `/api/members/${me.id}`),
    ]);
    me.reputation = myInfo.reputation;
    renderReputation();
    renderPasses(requests);
    renderTrips(trips);
    renderCarrying(requests, trips);
    renderBoard(trips, requests);
    setLive(true);
  } catch (e) {
    setLive(false);
  }
}

function setLive(ok) {
  const el = $("board-live");
  if (!el) return;
  el.style.color = ok ? "var(--green)" : "var(--red)";
  if (el.lastElementChild) el.lastElementChild.textContent = ok ? "live" : "reconnecting…";
}

function stubContent(r) {
  if (r.status === "pending") {
    return `<span class="pass-code-label">Status</span><span class="pass-code pass-code-muted">WAITING</span>`;
  }
  const showDelivery = r.status === "pickedUp" || r.status === "delivered";
  const code = showDelivery ? r.deliveryCode : r.pickupCode;
  if (!code) {
    return `<span class="pass-code-label">Status</span><span class="pass-code pass-code-muted">\u2014</span>`;
  }
  return `
    <span class="pass-code-label">${showDelivery ? "Delivery code" : "Pickup code"}</span>
    <span class="pass-code">${code}</span>
    <span class="pass-barcode" aria-hidden="true"></span>`;
}

function passActions(r) {
  if (r.status === "pending") return `<button class="btn-small ghost" data-cancel="${r.id}">Cancel request</button>`;
  if (r.status === "matched") return `<button class="btn-small danger" data-noshow="${r.id}">Report no-show</button>`;
  if (r.status === "pickedUp") return `<button class="btn-small" data-confirm-delivery="${r.id}">Confirm delivery</button>`;
  return "";
}

function renderPasses(requests) {
  const mine = requests.filter((r) => r.requesterId === me.id);
  $("passes-list").innerHTML = renderList(mine, (r) => `
      <div class="pass">
        <div class="pass-main">
          <div class="pass-desc">${esc(r.description)}</div>
          <div class="pass-meta">${typeLabel(r)} · ${r.valueTag === "high" ? "High value" : "Low value"} · needed by ${fmtTime(r.windowEnd)}</div>
          <span class="pass-status ${r.status}">${labelFor(r.status)}</span>
        </div>
        <div class="pass-stub">${stubContent(r)}</div>
        <div class="pass-actions">${passActions(r)}</div>
      </div>`, "Nothing posted yet. Post a request and it'll show up here.");
}

function labelFor(status) {
  return {
    pending: "Waiting for a match",
    matched: "Matched — show code at pickup",
    pickedUp: "Picked up — confirm on delivery",
    delivered: "Delivered",
    disputed: "Reported",
    cancelled: "Cancelled",
  }[status] || status;
}

function renderTrips(trips) {
  const mine = trips.filter((t) => t.carrierId === me.id);
  $("trips-list").innerHTML = renderList(mine, (t) => `
      <div class="trip-row">
        <div>
          <div class="trip-row-main">${t.direction === "toGate" ? "\u2192 Gate" : "\u2190 From gate"} · ${fmtTime(t.windowStart)}\u2013${fmtTime(t.windowEnd)}</div>
          <div class="trip-row-meta">${t.matchedRequestIds.length}/${t.capacity} carried · <span class="trip-status ${t.status}">${t.status === "open" ? "Open" : "Closed"}</span></div>
        </div>
        ${t.status === "open" ? `<button class="btn-small ghost" data-close-trip="${t.id}">Close trip</button>` : ""}
      </div>`, "You haven't posted a trip yet.");
}

function renderCarrying(requests, trips) {
  const myTripIds = new Set(trips.filter((t) => t.carrierId === me.id).map((t) => t.id));
  const carrying = requests.filter((r) => myTripIds.has(r.tripId) && ["matched", "pickedUp"].includes(r.status));
  $("carrying-list").innerHTML = renderList(carrying, (r) => `
      <div class="pass">
        <div class="pass-main">
          <div class="pass-desc">${esc(r.description)}</div>
          <div class="pass-meta">for ${esc(r.requesterName)} · ${typeLabel(r)} · by ${fmtTime(r.windowEnd)}</div>
          <span class="pass-status ${r.status}">${r.status === "matched" ? "Ask them to show you the pickup code" : "Picked up — deliver and have them confirm"}</span>
        </div>
        <div class="pass-actions">
          ${r.status === "matched" ? `<button class="btn-small" data-confirm-pickup="${r.id}">I have the item — confirm pickup</button>` : ""}
        </div>
      </div>`, "Nothing to carry yet. Post a trip and matching requests will show up here.");
}

function renderBoard(trips, requests) {
  const openTrips = trips.filter((t) => t.status === "open");
  syncFlapBoard(
    $("board-trips"),
    openTrips,
    (t) => t.id,
    (t) => ({
      text: `${t.direction === "toGate" ? "\u2192 GATE" : "\u2190 FROM GATE"}  ${fmtTime(t.windowStart)}-${fmtTime(t.windowEnd)}`,
      metaLeft: `${relativeTime(t.windowEnd)} left`,
      metaRight: `<span>${t.matchedRequestIds.length}/${t.capacity} carried</span>`,
    }),
    "No open trips right now."
  );

  const pending = requests.filter((r) => r.status === "pending");
  syncFlapBoard(
    $("board-requests"),
    pending,
    (r) => r.id,
    (r) => ({
      text: r.description,
      metaLeft: `${typeLabel(r)} · needed by ${fmtTime(r.windowEnd)}`,
      metaRight: r.valueTag === "high" ? `<span class="board-tag">High value</span>` : "",
    }),
    "No pending requests waiting for a carrier."
  );
}

// ---------- pass / trip actions (event delegation) ----------

$("carrying-list").addEventListener("click", async (ev) => {
  const confirmPickup = ev.target.closest("[data-confirm-pickup]");
  if (!confirmPickup) return;
  const id = confirmPickup.dataset.confirmPickup;
  const code = await promptCode({
    label: "PICKUP",
    title: "Confirm pickup",
    sub: "Enter the 4-digit pickup code the requester is showing you.",
  });
  if (!code) return;
  await withBusy(confirmPickup, async () => {
    try {
      await api("POST", `/api/requests/${id}/confirm-pickup`, { code });
      toast("Pickup confirmed", "success");
      refresh();
    } catch (e) { toast(e.message, "error"); }
  });
});

$("passes-list").addEventListener("click", async (ev) => {
  const noshow = ev.target.closest("[data-noshow]");
  const confirmDelivery = ev.target.closest("[data-confirm-delivery]");
  const cancel = ev.target.closest("[data-cancel]");
  const btn = noshow || confirmDelivery || cancel;
  if (!btn) return;

  if (cancel) {
    await withBusy(btn, async () => {
      try {
        await api("POST", `/api/requests/${cancel.dataset.cancel}/cancel`, {});
        toast("Request cancelled", "success");
        refresh();
      } catch (e) { toast(e.message, "error"); }
    });
    return;
  }
  if (noshow) {
    await withBusy(btn, async () => {
      try {
        await api("POST", `/api/requests/${noshow.dataset.noshow}/report-no-show`, {});
        toast("Reported — carrier's trust score updated", "success");
        refresh();
      } catch (e) { toast(e.message, "error"); }
    });
    return;
  }
  if (confirmDelivery) {
    const id = confirmDelivery.dataset.confirmDelivery;
    const code = await promptCode({
      label: "DELIVERY",
      title: "Confirm delivery",
      sub: "Enter the 4-digit delivery code the carrier is showing you.",
    });
    if (!code) return;
    await withBusy(btn, async () => {
      try {
        await api("POST", `/api/requests/${id}/confirm-delivery`, { code });
        toast("Delivered — carrier's trust score went up", "success");
        refresh();
      } catch (e) { toast(e.message, "error"); }
    });
  }
});

$("trips-list").addEventListener("click", async (ev) => {
  const closeBtn = ev.target.closest("[data-close-trip]");
  if (!closeBtn) return;
  await withBusy(closeBtn, async () => {
    try {
      await api("POST", `/api/trips/${closeBtn.dataset.closeTrip}/close`, {});
      toast("Trip closed", "success");
      refresh();
    } catch (e) { toast(e.message, "error"); }
  });
});

// ---------- code-entry modal ----------

function promptCode({ label, title, sub }) {
  const backdrop = $("modal-backdrop");
  const input = $("modal-code-input");
  const error = $("modal-error");

  $("modal-label").textContent = label;
  $("modal-title").textContent = title;
  $("modal-sub").textContent = sub;
  input.value = "";
  error.hidden = true;
  backdrop.hidden = false;
  requestAnimationFrame(() => input.focus());

  return new Promise((resolve) => {
    function close(result) {
      backdrop.hidden = true;
      cleanup();
      resolve(result);
    }
    function confirm() {
      const code = input.value.trim();
      if (!/^\d{4}$/.test(code)) {
        error.textContent = "Enter the 4-digit code.";
        error.hidden = false;
        input.focus();
        return;
      }
      close(code);
    }
    function onKeydown(ev) {
      if (ev.key === "Enter") confirm();
      if (ev.key === "Escape") close(null);
    }
    function onBackdropClick(ev) {
      if (ev.target === backdrop) close(null);
    }
    function cancelHandler() { close(null); }

    function cleanup() {
      $("modal-confirm").removeEventListener("click", confirm);
      $("modal-cancel").removeEventListener("click", cancelHandler);
      input.removeEventListener("keydown", onKeydown);
      backdrop.removeEventListener("click", onBackdropClick);
    }

    $("modal-confirm").addEventListener("click", confirm);
    $("modal-cancel").addEventListener("click", cancelHandler);
    input.addEventListener("keydown", onKeydown);
    backdrop.addEventListener("click", onBackdropClick);
  });
}

// ---------- utils ----------

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

const TOAST_ICONS = {
  info: `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>`,
  success: `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  error: `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
};

function toast(msg, variant = "info") {
  const stack = $("toast-stack");
  const el = document.createElement("div");
  el.className = `toast ${variant}`;
  el.innerHTML = `${TOAST_ICONS[variant] || TOAST_ICONS.info}<span>${esc(msg)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 200ms ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 200);
  }, 3200);
}

function startPolling() {
  refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 4000);
}
