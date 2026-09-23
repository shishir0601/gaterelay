import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth.jsx";
import Shell from "./components/Shell.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import PostTrip from "./pages/PostTrip.jsx";
import RequestPickup from "./pages/RequestPickup.jsx";
import Matches from "./pages/Matches.jsx";
import Handoff from "./pages/Handoff.jsx";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="auth-page">
        <div className="spinner" />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route path="/" element={!loading && user ? <Navigate to="/dashboard" replace /> : <AuthPage />} />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/trips/new" element={<PostTrip />} />
        <Route path="/requests/new" element={<RequestPickup />} />
        <Route path="/requests/:requestId/matches" element={<Matches />} />
        <Route path="/handoffs/:handoffId" element={<Handoff />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
