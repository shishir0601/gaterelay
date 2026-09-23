import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import RequestPickup from "./RequestPickup.jsx";
import { ApiError } from "../lib/api.js";

const mockCreateRequest = vi.fn();

vi.mock("../lib/api.js", async () => {
  const actual = await vi.importActual("../lib/api.js");
  return { ...actual, api: { ...actual.api, createRequest: (...a) => mockCreateRequest(...a) } };
});

function renderRequestPickup() {
  return render(
    <MemoryRouter initialEntries={["/requests/new"]}>
      <Routes>
        <Route path="/requests/new" element={<RequestPickup />} />
        <Route path="/requests/:requestId/matches" element={<div>MATCHES_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillValidForm(user) {
  await user.type(screen.getByLabelText(/pickup location/i), "Hyderabad");
  await user.type(screen.getByLabelText(/delivery location/i), "Warangal");
  fireEvent.change(document.querySelector("#earliest"), { target: { value: "2026-10-01T16:00" } });
  fireEvent.change(document.querySelector("#latest"), { target: { value: "2026-10-01T20:00" } });
}

beforeEach(() => {
  mockCreateRequest.mockReset();
});

describe("RequestPickup", () => {
  it("submits a valid request and navigates straight to its matches page", async () => {
    mockCreateRequest.mockResolvedValue({ id: "req1" });
    const user = userEvent.setup();
    renderRequestPickup();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /find matches/i }));

    expect(await screen.findByText("MATCHES_PAGE")).toBeInTheDocument();
    expect(mockCreateRequest).toHaveBeenCalledWith(
      expect.objectContaining({ pickup_location: "Hyderabad", delivery_location: "Warangal", item_size: "MEDIUM" }),
    );
  });

  it("rejects a latest time at or before the earliest time before ever calling the API -- client-side validation added during review, since this previously only surfaced as a server error after a round-trip", async () => {
    const user = userEvent.setup();
    renderRequestPickup();

    await user.type(screen.getByLabelText(/pickup location/i), "Hyderabad");
    await user.type(screen.getByLabelText(/delivery location/i), "Warangal");
    fireEvent.change(document.querySelector("#earliest"), { target: { value: "2026-10-01T20:00" } });
    fireEvent.change(document.querySelector("#latest"), { target: { value: "2026-10-01T16:00" } }); // before earliest
    await user.click(screen.getByRole("button", { name: /find matches/i }));

    expect(await screen.findByText(/must be after earliest/i)).toBeInTheDocument();
    expect(mockCreateRequest).not.toHaveBeenCalled();
  });

  it("shows the server's error message if submission fails", async () => {
    mockCreateRequest.mockRejectedValue(new ApiError(422, "item_size: invalid value"));
    const user = userEvent.setup();
    renderRequestPickup();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /find matches/i }));

    expect(await screen.findByText(/invalid value/i)).toBeInTheDocument();
  });

  it("defaults item size to Medium, with Small/Medium/Large as the only options", () => {
    renderRequestPickup();
    const select = screen.getByLabelText(/item size/i);
    expect(select.value).toBe("MEDIUM");
    expect(screen.getAllByRole("option").map((o) => o.value)).toEqual(["SMALL", "MEDIUM", "LARGE"]);
  });

  it("lets the user change the item size before submitting", async () => {
    mockCreateRequest.mockResolvedValue({ id: "req1" });
    const user = userEvent.setup();
    renderRequestPickup();

    await fillValidForm(user);
    await user.selectOptions(screen.getByLabelText(/item size/i), "LARGE");
    await user.click(screen.getByRole("button", { name: /find matches/i }));

    expect(mockCreateRequest).toHaveBeenCalledWith(expect.objectContaining({ item_size: "LARGE" }));
  });
});
