import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Handoff from "./Handoff.jsx";
import { AuthProvider } from "../lib/auth.jsx";
import { ApiError } from "../lib/api.js";

const mockGetHandoff = vi.fn();
const mockGenerateOtp = vi.fn();
const mockVerifyOtp = vi.fn();
const mockMe = vi.fn();

vi.mock("../lib/api.js", async () => {
  const actual = await vi.importActual("../lib/api.js");
  return {
    ...actual,
    api: {
      ...actual.api,
      getHandoff: (...a) => mockGetHandoff(...a),
      generateOtp: (...a) => mockGenerateOtp(...a),
      verifyOtp: (...a) => mockVerifyOtp(...a),
      me: (...a) => mockMe(...a),
    },
  };
});

const baseHandoff = {
  id: "h1",
  status: "PENDING",
  otp_expires_at: null,
  completed_at: null,
  trip: { id: "t1", user_id: "traveler-id", origin: "Hyderabad", destination: "Warangal", departure_time: "2026-10-01T18:00:00", owner_name: "Priya" },
  request: { id: "r1", user_id: "requester-id", owner_name: "Rahul" },
};

function renderAsUser(userId) {
  localStorage.setItem("gaterelay_token", "fake-token");
  mockMe.mockResolvedValue({ id: userId, name: userId === "traveler-id" ? "Priya" : "Rahul", email: "x@example.com" });
  return render(
    <MemoryRouter initialEntries={["/handoffs/h1"]}>
      <AuthProvider>
        <Routes>
          <Route path="/handoffs/:handoffId" element={<Handoff />} />
          <Route path="/dashboard" element={<div>DASHBOARD_PAGE</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockGetHandoff.mockReset();
  mockGenerateOtp.mockReset();
  mockVerifyOtp.mockReset();
  mockMe.mockReset();
});

describe("Handoff -- traveler view", () => {
  it("shows a generate-code button before any code exists", async () => {
    mockGetHandoff.mockResolvedValue(baseHandoff);
    renderAsUser("traveler-id");
    expect(await screen.findByRole("button", { name: /generate code/i })).toBeInTheDocument();
  });

  it("displays the generated code after clicking generate, without a second network call to refresh it -- regression test for a real bug found during review: generate() used to also call load() again afterward, and if THAT redundant call failed, its error ('Could not load this handoff') overwrote the fact that a code had actually been generated successfully and was already on screen", async () => {
    mockGetHandoff.mockResolvedValue(baseHandoff);
    mockGenerateOtp.mockResolvedValue({ code: "482913", expires_at: "2026-10-01T18:10:00" });
    const user = userEvent.setup();
    renderAsUser("traveler-id");

    await user.click(await screen.findByRole("button", { name: /generate code/i }));

    expect(await screen.findByText("482913")).toBeInTheDocument();
    // getHandoff should only have been called once -- the initial load -- never again as
    // part of generating a code, since generateOtp's own response already has everything
    // (expires_at) needed to update the UI.
    expect(mockGetHandoff).toHaveBeenCalledTimes(1);
  });

  it("shows an error if code generation itself fails", async () => {
    mockGetHandoff.mockResolvedValue(baseHandoff);
    mockGenerateOtp.mockRejectedValue(new ApiError(409, "This handoff is already complete"));
    const user = userEvent.setup();
    renderAsUser("traveler-id");

    await user.click(await screen.findByRole("button", { name: /generate code/i }));
    expect(await screen.findByText(/already complete/i)).toBeInTheDocument();
  });
});

describe("Handoff -- requester view", () => {
  it("shows a waiting message when no code has been generated yet", async () => {
    mockGetHandoff.mockResolvedValue(baseHandoff);
    renderAsUser("requester-id");
    expect(await screen.findByText(/waiting for the traveler/i)).toBeInTheDocument();
  });

  it("shows the code entry form once a live code exists, and submits it", async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 19);
    mockGetHandoff.mockResolvedValue({ ...baseHandoff, otp_expires_at: future });
    mockVerifyOtp.mockResolvedValue({ ...baseHandoff, status: "COMPLETED", completed_at: "2026-10-01T18:05:00", otp_expires_at: future });
    const user = userEvent.setup();
    renderAsUser("requester-id");

    const input = await screen.findByLabelText(/6-digit code/i);
    await user.type(input, "482913");
    await user.click(screen.getByRole("button", { name: /verify and complete/i }));

    expect(mockVerifyOtp).toHaveBeenCalledWith("h1", "482913");
    expect(await screen.findByText((_, el) => el.textContent?.includes("Confirmed") ?? false, { selector: "div.page-subtitle" })).toBeInTheDocument();
  });

  it("shows an error on an incorrect code", async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 19);
    mockGetHandoff.mockResolvedValue({ ...baseHandoff, otp_expires_at: future });
    mockVerifyOtp.mockRejectedValue(new ApiError(400, "Incorrect code"));
    const user = userEvent.setup();
    renderAsUser("requester-id");

    const input = await screen.findByLabelText(/6-digit code/i);
    await user.type(input, "000000");
    await user.click(screen.getByRole("button", { name: /verify and complete/i }));

    expect(await screen.findByText(/incorrect code/i)).toBeInTheDocument();
  });

  it("only accepts exactly 6 digits, stripping non-numeric characters", async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 19);
    mockGetHandoff.mockResolvedValue({ ...baseHandoff, otp_expires_at: future });
    const user = userEvent.setup();
    renderAsUser("requester-id");

    const input = await screen.findByLabelText(/6-digit code/i);
    await user.type(input, "12ab34");
    expect(input).toHaveValue("1234");
    expect(screen.getByRole("button", { name: /verify and complete/i })).toBeDisabled();
  });
});

describe("Handoff -- completed state", () => {
  it("shows the completion confirmation to both parties, not the generate/verify forms", async () => {
    mockGetHandoff.mockResolvedValue({ ...baseHandoff, status: "COMPLETED", completed_at: "2026-10-01T18:05:00" });
    renderAsUser("traveler-id");
    // "Confirmed <date>" is rendered as "Confirmed " plus a separate interpolated date
    // expression, which are two sibling text nodes rather than one -- a substring
    // textContent matcher sidesteps RTL's default per-node text matching for that case.
    expect(await screen.findByText((_, el) => el.textContent?.includes("Confirmed") ?? false, { selector: "div.page-subtitle" })).toBeInTheDocument();
    expect(screen.getAllByText(/delivery complete/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /generate code/i })).not.toBeInTheDocument();
  });
});

describe("Handoff -- loading and error states", () => {
  it("shows an error and a way back if the handoff can't be loaded at all", async () => {
    mockGetHandoff.mockRejectedValue(new ApiError(404, "Handoff not found"));
    const user = userEvent.setup();
    renderAsUser("traveler-id");

    expect(await screen.findByText(/handoff not found/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /back to dashboard/i }));
    expect(await screen.findByText("DASHBOARD_PAGE")).toBeInTheDocument();
  });
});
