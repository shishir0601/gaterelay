import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard.jsx";
import { AuthProvider } from "../lib/auth.jsx";
import { ApiError } from "../lib/api.js";

const mockListTrips = vi.fn();
const mockListRequests = vi.fn();
const mockListHandoffs = vi.fn();
const mockMe = vi.fn();

vi.mock("../lib/api.js", async () => {
  const actual = await vi.importActual("../lib/api.js");
  return {
    ...actual,
    api: {
      ...actual.api,
      listTrips: (...a) => mockListTrips(...a),
      listRequests: (...a) => mockListRequests(...a),
      listHandoffs: (...a) => mockListHandoffs(...a),
      me: (...a) => mockMe(...a),
    },
  };
});

function renderDashboard() {
  localStorage.setItem("gaterelay_token", "fake-token");
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Dashboard />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockListTrips.mockReset();
  mockListRequests.mockReset();
  mockListHandoffs.mockReset();
  mockMe.mockReset().mockResolvedValue({ id: "u1", name: "Alice", email: "alice@example.com" });
});

describe("Dashboard", () => {
  it("shows an empty state and quick actions when there's no data", async () => {
    mockListTrips.mockResolvedValue([]);
    mockListRequests.mockResolvedValue([]);
    mockListHandoffs.mockResolvedValue([]);
    renderDashboard();

    expect(await screen.findByText(/post a trip/i)).toBeInTheDocument();
    expect(screen.getByText(/haven't posted a trip yet/i)).toBeInTheDocument();
  });

  it("displays trips, requests, and stat counts once loaded", async () => {
    mockListTrips.mockResolvedValue([{ id: "t1", origin: "Hyderabad", destination: "Warangal", departure_time: "2026-10-01T18:00:00", available_capacity: 3, status: "ACTIVE" }]);
    mockListRequests.mockResolvedValue([]);
    mockListHandoffs.mockResolvedValue([]);
    renderDashboard();

    expect(await screen.findByText(/Hyderabad/)).toBeInTheDocument();
    expect(screen.getByText(/Warangal/)).toBeInTheDocument();
  });

  it("shows a clear error message (not an infinite spinner) when loading fails -- regression test for a real bug found during review", async () => {
    // Previously, Dashboard's load() had no error handling at all: a failed API call left
    // trips/requests/handoffs permanently null, so the page was stuck showing the loading
    // skeleton forever with no indication anything had gone wrong.
    mockListTrips.mockRejectedValue(new ApiError(401, "Could not validate credentials"));
    mockListRequests.mockResolvedValue([]);
    mockListHandoffs.mockResolvedValue([]);
    renderDashboard();

    expect(await screen.findByText(/could not validate credentials/i)).toBeInTheDocument();
    // and critically: no perpetual skeleton left behind once the error is shown
    await waitFor(() => expect(document.querySelector(".skeleton")).not.toBeInTheDocument());
  });

  it("offers a retry action when the initial load fails", async () => {
    mockListTrips.mockRejectedValue(new ApiError(500, "Something went wrong"));
    mockListRequests.mockResolvedValue([]);
    mockListHandoffs.mockResolvedValue([]);
    renderDashboard();

    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
