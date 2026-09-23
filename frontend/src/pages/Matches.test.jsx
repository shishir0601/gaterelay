import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Matches from "./Matches.jsx";
import { ApiError } from "../lib/api.js";

const mockGetMatches = vi.fn();
const mockAcceptMatch = vi.fn();

vi.mock("../lib/api.js", async () => {
  const actual = await vi.importActual("../lib/api.js");
  return { ...actual, api: { ...actual.api, getMatches: (...a) => mockGetMatches(...a), acceptMatch: (...a) => mockAcceptMatch(...a) } };
});

const sampleMatch = {
  match_id: "trip1:req1",
  score: 92,
  reasons: ["Same origin", "Same destination", "Excellent time overlap"],
  trip: { id: "trip1", origin: "Hyderabad", destination: "Warangal", departure_time: "2026-10-01T18:00:00", available_capacity: 3, owner_name: "Priya" },
};

function renderMatches() {
  return render(
    <MemoryRouter initialEntries={["/requests/req1/matches"]}>
      <Routes>
        <Route path="/requests/:requestId/matches" element={<Matches />} />
        <Route path="/handoffs/:handoffId" element={<div>HANDOFF_PAGE</div>} />
        <Route path="/dashboard" element={<div>DASHBOARD_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockGetMatches.mockReset();
  mockAcceptMatch.mockReset();
});

describe("Matches", () => {
  it("shows an empty state when there are no compatible trips", async () => {
    mockGetMatches.mockResolvedValue([]);
    renderMatches();
    expect(await screen.findByText(/no matches yet/i)).toBeInTheDocument();
  });

  it("displays the score, reasons, and traveler name for each match", async () => {
    mockGetMatches.mockResolvedValue([sampleMatch]);
    renderMatches();

    expect(await screen.findByText("92%")).toBeInTheDocument();
    expect(screen.getByText("Same origin")).toBeInTheDocument();
    expect(screen.getByText("Excellent time overlap")).toBeInTheDocument();
    expect(screen.getByText(/Priya/)).toBeInTheDocument();
  });

  it("shows an error message if loading matches fails", async () => {
    mockGetMatches.mockRejectedValue(new ApiError(404, "Request not found"));
    renderMatches();
    expect(await screen.findByText(/request not found/i)).toBeInTheDocument();
  });

  it("accepting a match navigates to its handoff page", async () => {
    mockGetMatches.mockResolvedValue([sampleMatch]);
    mockAcceptMatch.mockResolvedValue({ handoff_id: "h1" });
    const user = userEvent.setup();
    renderMatches();

    await user.click(await screen.findByRole("button", { name: /accept/i }));
    expect(await screen.findByText("HANDOFF_PAGE")).toBeInTheDocument();
    expect(mockAcceptMatch).toHaveBeenCalledWith("trip1:req1");
  });

  it("shows a clear error and refreshes the list when a match has gone stale (someone else took it first)", async () => {
    mockGetMatches.mockResolvedValueOnce([sampleMatch]).mockResolvedValueOnce([]); // second call (the refresh) finds nothing left
    mockAcceptMatch.mockRejectedValue(new ApiError(409, "This match is no longer valid"));
    const user = userEvent.setup();
    renderMatches();

    await user.click(await screen.findByRole("button", { name: /accept/i }));
    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
    await waitFor(() => expect(mockGetMatches).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/no matches yet/i)).toBeInTheDocument();
  });

  it("the back button returns to the dashboard", async () => {
    mockGetMatches.mockResolvedValue([]);
    const user = userEvent.setup();
    renderMatches();

    await user.click(await screen.findByRole("button", { name: /back to dashboard/i }));
    expect(await screen.findByText("DASHBOARD_PAGE")).toBeInTheDocument();
  });
});
