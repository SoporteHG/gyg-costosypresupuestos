import { useEffect, useState } from "react";
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

export default function Topbar({ userEmail, onLoggedOut, company, branding, themeMode, onToggleTheme }) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const companyName = branding?.business_name || company?.name || "Tu empresa";

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const formattedDate = new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(now);

  const formattedTime = new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);

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
        <button
          type="button"
          className={`theme-switch ${themeMode === "dark" ? "is-active" : ""}`}
          onClick={onToggleTheme}
          aria-label={themeMode === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        >
          <span className="theme-switch-track">
            <span className="theme-switch-thumb" />
          </span>
          <span className="theme-switch-label">{themeMode === "dark" ? "Dark" : "Light"}</span>
        </button>
        <div className="user">{userEmail || "Usuario"}</div>
        <div className="topbar-clock" aria-label={`Fecha ${formattedDate} y hora ${formattedTime}`}>
          <span className="topbar-clock-date">{formattedDate}</span>
          <strong className="topbar-clock-time">{formattedTime}</strong>
        </div>
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
