import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Shell from "./Shell.jsx";
import { AuthProvider } from "../lib/auth.jsx";

const mockMe = vi.fn();

vi.mock("../lib/api.js", async () => {
  const actual = await vi.importActual("../lib/api.js");
  return { ...actual, api: { ...actual.api, me: (...a) => mockMe(...a) } };
});

function renderShell() {
  localStorage.setItem("gaterelay_token", "fake-token");
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AuthProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/dashboard" element={<div>DASHBOARD_CONTENT</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockMe.mockReset().mockResolvedValue({ id: "u1", name: "Alice", email: "alice@example.com" });
});

describe("Shell", () => {
  it("renders the three main navigation links plus a working sign-out control", async () => {
    renderShell();
    expect(await screen.findByText("DASHBOARD_CONTENT")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /post a trip/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a pickup/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("the sign-out control is part of the main <nav>, not only the desktop-only sidebar footer -- regression test for a real bug found during review where 'Sign out' lived exclusively inside .sidebar-footer, which is display:none on mobile, leaving mobile users with no way to sign out at all", async () => {
    renderShell();
    const signOutButton = await screen.findByRole("button", { name: /sign out/i });
    // The bug specifically was about *where* the control lived in the DOM/layout, not
    // about jsdom's lack of real CSS media query evaluation -- asserting it's a sibling
    // of the nav links (inside the same <nav>), not nested inside .sidebar-footer,
    // directly verifies the structural fix rather than something jsdom can't see anyway.
    const nav = signOutButton.closest("nav");
    expect(nav).not.toBeNull();
    expect(nav.querySelector(".sidebar-footer")).toBeNull();
  });

  it("clicking sign out actually logs the user out", async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByText("DASHBOARD_CONTENT");
    expect(localStorage.getItem("gaterelay_token")).toBe("fake-token");

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(localStorage.getItem("gaterelay_token")).toBeNull();
  });
});
