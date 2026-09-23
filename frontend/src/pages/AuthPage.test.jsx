import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AuthPage from "./AuthPage.jsx";
import { AuthProvider } from "../lib/auth.jsx";
import { ApiError } from "../lib/api.js";

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockMe = vi.fn();

vi.mock("../lib/api.js", async () => {
  const actual = await vi.importActual("../lib/api.js");
  return {
    ...actual,
    api: { ...actual.api, login: (...a) => mockLogin(...a), register: (...a) => mockRegister(...a), me: (...a) => mockMe(...a) },
  };
});

function renderAuthPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<AuthPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockLogin.mockReset();
  mockRegister.mockReset();
  mockMe.mockReset();
});

describe("AuthPage", () => {
  it("starts in login mode, with only email/password fields (no name field)", () => {
    renderAuthPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
  });

  it("switches to register mode and shows the name field", async () => {
    const user = userEvent.setup();
    renderAuthPage();
    await user.click(screen.getByRole("button", { name: /register/i }));
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it("submits login credentials and calls the login API", async () => {
    mockLogin.mockResolvedValue({ access_token: "tok123" });
    mockMe.mockResolvedValue({ id: "u1", name: "Alice", email: "alice@example.com" });
    const user = userEvent.setup();
    renderAuthPage();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("alice@example.com", "password123"));
  });

  it("submits registration with name, email, and password", async () => {
    mockRegister.mockResolvedValue({ id: "u1", name: "Bob", email: "bob@example.com" });
    mockLogin.mockResolvedValue({ access_token: "tok456" });
    mockMe.mockResolvedValue({ id: "u1", name: "Bob", email: "bob@example.com" });
    const user = userEvent.setup();
    renderAuthPage();

    await user.click(screen.getByRole("button", { name: /register/i }));
    await user.type(screen.getByLabelText(/name/i), "Bob");
    await user.type(screen.getByLabelText(/email/i), "bob@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith("Bob", "bob@example.com", "password123"));
  });

  it("shows the server's error message on a failed login, and doesn't crash", async () => {
    mockLogin.mockRejectedValue(new ApiError(401, "Incorrect email or password"));
    const user = userEvent.setup();
    renderAuthPage();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpassword");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument();
  });

  it("shows the duplicate-email error on failed registration", async () => {
    mockRegister.mockRejectedValue(new ApiError(409, "An account with this email already exists"));
    const user = userEvent.setup();
    renderAuthPage();

    await user.click(screen.getByRole("button", { name: /register/i }));
    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });

  it("requires a password of at least 8 characters (HTML validation)", () => {
    renderAuthPage();
    const passwordInput = screen.getByLabelText(/password/i);
    expect(passwordInput).toHaveAttribute("minLength", "8");
    expect(passwordInput).toBeRequired();
  });
});
