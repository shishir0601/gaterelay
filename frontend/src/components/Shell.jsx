import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Send, PackageSearch, LogOut } from "lucide-react";
import { useAuth } from "../lib/auth.jsx";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/trips/new", label: "Post a Trip", icon: Send },
  { to: "/requests/new", label: "Request a Pickup", icon: PackageSearch },
];

export default function Shell() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="sidebar-brand">
            gate<span className="dot">relay</span>
          </div>
          <div className="sidebar-tagline">Don't make the trip. Relay it.</div>
        </div>
        <nav>
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
          {/* Deliberately part of the same <nav> as the links above, not just the
              desktop-only .sidebar-footer below: a real bug found during review was that
              .sidebar-footer (the only place "Sign out" lived) is hidden entirely on
              mobile (display: none, see index.css), leaving a mobile user with no way to
              sign out at all. Rendering it here too means it naturally participates in
              the same responsive flex layout as Dashboard/Post a Trip/Request a Pickup —
              a row of icons on mobile, a vertical list on desktop — without a separate,
              easy-to-forget mobile-specific rule. */}
          <button className="nav-link nav-link-signout" onClick={logout} aria-label="Sign out">
            <LogOut size={17} />
            <span>Sign out</span>
          </button>
        </nav>
        <div className="sidebar-footer">
          <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{user?.name}</div>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
