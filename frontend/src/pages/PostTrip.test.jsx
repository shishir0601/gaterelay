import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PostTrip from "./PostTrip.jsx";
import { ApiError } from "../lib/api.js";

const mockCreateTrip = vi.fn();

vi.mock("../lib/api.js", async () => {
  const actual = await vi.importActual("../lib/api.js");
  return { ...actual, api: { ...actual.api, createTrip: (...a) => mockCreateTrip(...a) } };
});

function renderPostTrip() {
  return render(
    <MemoryRouter initialEntries={["/trips/new"]}>
      <Routes>
        <Route path="/trips/new" element={<PostTrip />} />
        <Route path="/dashboard" element={<div>DASHBOARD_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillValidForm(user) {
  await user.type(screen.getByLabelText(/^origin$/i), "Hyderabad");
  await user.type(screen.getByLabelText(/^destination$/i), "Warangal");
  fireEvent.change(document.querySelector("#departure"), { target: { value: "2026-10-01T18:00" } });
}

beforeEach(() => {
  mockCreateTrip.mockReset();
});

describe("PostTrip", () => {
  it("submits a valid trip and navigates to the dashboard", async () => {
    mockCreateTrip.mockResolvedValue({ id: "t1" });
    const user = userEvent.setup();
    renderPostTrip();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /post trip/i }));

    expect(await screen.findByText("DASHBOARD_PAGE")).toBeInTheDocument();
    expect(mockCreateTrip).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "Hyderabad", destination: "Warangal", available_capacity: 2 }),
    );
  });

  it("rejects a same origin/destination before ever calling the API -- client-side validation added during review, since this previously only surfaced as a server error after a round-trip", async () => {
    const user = userEvent.setup();
    renderPostTrip();

    await user.type(screen.getByLabelText(/^origin$/i), "Hyderabad");
    await user.type(screen.getByLabelText(/^destination$/i), "hyderabad"); // same place, different case
    fireEvent.change(document.querySelector("#departure"), { target: { value: "2026-10-01T18:00" } });
    await user.click(screen.getByRole("button", { name: /post trip/i }));

    expect(await screen.findByText(/destination must be different/i)).toBeInTheDocument();
    expect(mockCreateTrip).not.toHaveBeenCalled();
  });

  it("shows the server's error message if submission fails", async () => {
    mockCreateTrip.mockRejectedValue(new ApiError(422, "available_capacity: must be at least 1"));
    const user = userEvent.setup();
    renderPostTrip();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /post trip/i }));

    expect(await screen.findByText(/must be at least 1/i)).toBeInTheDocument();
  });

  it("disables the submit button while the request is in flight", async () => {
    let resolveCreate;
    mockCreateTrip.mockReturnValue(new Promise((resolve) => (resolveCreate = resolve)));
    const user = userEvent.setup();
    renderPostTrip();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /post trip/i }));

    expect(screen.getByRole("button")).toBeDisabled();
    resolveCreate({ id: "t1" });
  });

  it("offers capacity options from 1 to 6 units, defaulting to 2", () => {
    renderPostTrip();
    const select = screen.getByLabelText(/available capacity/i);
    expect(select.value).toBe("2");
    expect(screen.getAllByRole("option")).toHaveLength(6);
  });
});
