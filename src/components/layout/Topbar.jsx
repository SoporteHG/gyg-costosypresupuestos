import { useState } from "react";
import "./layout.css";
import { supabase } from "../../lib/supabase";

const LOGOUT_TIMEOUT_MS = 3000;

function clearStoredSupabaseSession() {
  const keysToRemove = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => window.localStorage.removeItem(key));
}

export default function Topbar({ userEmail, onLoggedOut, company, branding }) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const companyName = branding?.business_name || company?.name || "Tu empresa";

  async function handleLogout() {
    setIsLoggingOut(true);
    setLogoutError("");

    clearStoredSupabaseSession();
    onLoggedOut?.();

    try {
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }),
        new Promise((_, reject) => {
          window.setTimeout(() => {
            reject(new Error("Tiempo de espera agotado al cerrar sesion."));
          }, LOGOUT_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      console.error("Error al cerrar sesion:", error);
    }
  }

  return (
    <header className="topbar">
      <div>
        <h3>{companyName}</h3>
        <p className="topbar-copy">Portal de costos y presupuestos</p>
      </div>
      <div className="topbar-actions">
        {logoutError ? <p className="topbar-error">{logoutError}</p> : null}
        <div className="user">{userEmail || "Usuario"}</div>
        <button
          onClick={handleLogout}
          className="primary-btn"
          type="button"
          disabled={isLoggingOut}
        >
          {isLoggingOut ? "Saliendo..." : "Salir"}
        </button>
      </div>
    </header>
  );
}
