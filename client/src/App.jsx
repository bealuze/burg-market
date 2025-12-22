import { useEffect, useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "./components/Navbar.jsx";
import Listings from "./pages/Listings.jsx";
import MyListings from "./pages/MyListings.jsx";
import Faq from "./pages/Faq.jsx";
import AuthModal from "./components/AuthModal.jsx";
import { apiLogout, clearToken, getToken } from "./api/api.js";

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setTokenState] = useState(() => getToken());
  const [authOpen, setAuthOpen] = useState(false);
  const [authNotice, setAuthNotice] = useState(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const isLoggedIn = useMemo(() => Boolean(token), [token]);

  useEffect(() => {
    const path = location.pathname || "/";
    if (path === "/mylistings") {
      document.title = "My Listings — Burg Market";
      return;
    }
    if (path === "/faq") {
      document.title = "FAQ — Burg Market";
      return;
    }
    document.title = "Burg Market";
  }, [location.pathname]);

  function requestLogout() {
    setLogoutConfirmOpen(true);
  }

  async function confirmLogout() {
    try {
      await apiLogout();
    } catch {
      // non-fatal
    }
    clearToken();
    setTokenState(null);
    setLogoutConfirmOpen(false);
    navigate("/", { replace: true });
  }

  return (
    <div style={{ width: "100%" }}>
      <Navbar
        isLoggedIn={isLoggedIn}
        onOpenAuth={(notice) => {
          setAuthNotice(typeof notice === "string" && notice.trim() ? notice : null);
          setAuthOpen(true);
        }}
        onLogout={requestLogout}
      />
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: 16, width: "100%" }}>
        <Routes>
          <Route
            path="/"
            element={
              <Listings
                token={token}
                onOpenAuth={(notice) => {
                  setAuthNotice(typeof notice === "string" && notice.trim() ? notice : null);
                  setAuthOpen(true);
                }}
              />
            }
          />
          <Route
            path="/mylistings"
            element={
              <MyListings
                token={token}
                onOpenAuth={(notice) => {
                  setAuthNotice(typeof notice === "string" && notice.trim() ? notice : null);
                  setAuthOpen(true);
                }}
              />
            }
          />

		  <Route path="/faq" element={<Faq />} />
        </Routes>
      </main>

      <AuthModal
        isOpen={authOpen}
        notice={authNotice}
        onClose={() => {
          setAuthOpen(false);
          setAuthNotice(null);
        }}
        onSuccess={(newToken) => {
          setTokenState(newToken);
          setAuthOpen(false);
          setAuthNotice(null);
        }}
      />

      {logoutConfirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(31, 79, 163, 0.12)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 70,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLogoutConfirmOpen(false);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              background: "var(--gb-surface)",
              border: "1px solid var(--gb-border)",
              borderRadius: 12,
              padding: 16,
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Log out?</h2>
              <button type="button" onClick={() => setLogoutConfirmOpen(false)}>
                Close
              </button>
            </div>

            <p style={{ margin: "12px 0 0", opacity: 0.9 }}>You’ll be signed out of Burg Market.</p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <button type="button" onClick={() => setLogoutConfirmOpen(false)}>
                Cancel
              </button>
              <button type="button" onClick={confirmLogout} className="gbDangerButton">
                Log out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
