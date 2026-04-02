import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { getCurrentCompanyContext } from "./lib/company";
import {
  getAdminContext,
  logPlatformAccess,
  markUserPresenceOffline,
  PRESENCE_HEARTBEAT_MS,
  touchUserPresence,
} from "./lib/admin";
import { Routes, Route, Navigate } from "react-router-dom";

import AppLayout from "./components/layout/AppLayout";
import DashboardPage from "./pages/dashboard/DashboardPage";
import ClientesPage from "./pages/clientes/ClientesManagerPage";
import ProductosPage from "./pages/productos/ProductosPage";
import InventarioPage from "./pages/inventario/InventarioPage";
import ProveedoresPage from "./pages/proveedores/ProveedoresPage";
import VendedoresPage from "./pages/vendedores/VendedoresPage";
import CotizacionesPage from "./pages/cotizaciones/CotizacionesPage";
import PuntoVentaPage from "./pages/ventas/PuntoVentaPage";
import ReportesPage from "./pages/reportes/ReportesPage";
import SoportePage from "./pages/soporte/SoportePage";
import ConfiguracionPage from "./pages/settings/ConfiguracionPage";
import SuperAdminPage from "./pages/admin/SuperAdminPage";
import TicketsAdminPage from "./pages/admin/TicketsAdminPage";
import LoginPage from "./pages/auth/LoginPage";

function App() {
  const [session, setSession] = useState(undefined);
  const [companyContext, setCompanyContext] = useState(null);
  const [companyContextError, setCompanyContextError] = useState("");
  const [adminContext, setAdminContext] = useState({
    isSuperAdmin: false,
    role: "user",
    source: "none",
  });
  const isLoadingCompanyRef = useRef(false);
  const lastAuditKeyRef = useRef("");

  function handleLoggedOut() {
    setSession(null);
    setCompanyContext(null);
    setCompanyContextError("");
    setAdminContext({
      isSuperAdmin: false,
      role: "user",
      source: "none",
    });
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        await Promise.all([
          loadCompanyContext(data.session.user.id),
          loadAdminState(data.session.user),
        ]);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session?.user) {
        await Promise.all([
          loadCompanyContext(session.user.id),
          loadAdminState(session.user),
        ]);
      } else {
        setCompanyContext(null);
        setAdminContext({
          isSuperAdmin: false,
          role: "user",
          source: "none",
        });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadCompanyContext(userId) {
    if (isLoadingCompanyRef.current) {
      return;
    }

    try {
      isLoadingCompanyRef.current = true;
      setCompanyContextError("");
      const context = await getCurrentCompanyContext(userId);
      setCompanyContext(context);
    } catch (error) {
      console.error("Error cargando el contexto de empresa:", error);
      if (!companyContext) {
        setCompanyContext(null);
      }
      setCompanyContextError(error.message || "No se pudo cargar la empresa activa.");
    } finally {
      isLoadingCompanyRef.current = false;
    }
  }

  async function loadAdminState(user) {
    const context = await getAdminContext(user);
    setAdminContext(context);
  }

  useEffect(() => {
    const userId = session?.user?.id;
    const companyId = companyContext?.company?.id;

    if (!userId || !companyId) {
      return;
    }

    const auditKey = `${userId}:${companyId}`;
    if (lastAuditKeyRef.current === auditKey) {
      return;
    }

    lastAuditKeyRef.current = auditKey;
    logPlatformAccess({
      user: session.user,
      company: companyContext.company,
    });
  }, [session?.user, companyContext?.company]);

  useEffect(() => {
    const user = session?.user;
    const company = companyContext?.company;

    if (!user?.id || !company?.id) {
      return undefined;
    }

    touchUserPresence({ user, company });

    const intervalId = window.setInterval(() => {
      touchUserPresence({ user, company });
    }, PRESENCE_HEARTBEAT_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        touchUserPresence({ user, company });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      markUserPresenceOffline({ user, company });
    };
  }, [session?.user, companyContext?.company]);

  if (session === undefined) {
    return <div style={{ padding: 20 }}>Cargando...</div>;
  }

  if (!session) {
    return <LoginPage />;
  }

  if (!companyContext) {
    return (
      <div style={{ padding: 20 }}>
        <div>Cargando empresa...</div>
        {companyContextError ? (
          <div style={{ marginTop: 12, color: "#dc2626" }}>{companyContextError}</div>
        ) : null}
      </div>
    );
  }

  return (
    <AppLayout
      userEmail={session.user?.email}
      onLogout={handleLoggedOut}
      company={companyContext.company}
      branding={companyContext.branding}
      isSuperAdmin={adminContext.isSuperAdmin}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={
            <DashboardPage
              currentUser={session.user}
              companyId={companyContext.companyId}
              company={companyContext.company}
              branding={companyContext.branding}
            />
          }
        />
        <Route
          path="/clientes"
          element={<ClientesPage currentUser={session.user} companyId={companyContext.companyId} />}
        />
        <Route
          path="/productos"
          element={<ProductosPage currentUser={session.user} companyId={companyContext.companyId} />}
        />
        <Route
          path="/inventario"
          element={<InventarioPage currentUser={session.user} companyId={companyContext.companyId} />}
        />
        <Route
          path="/proveedores"
          element={<ProveedoresPage currentUser={session.user} companyId={companyContext.companyId} />}
        />
        <Route
          path="/vendedores"
          element={<VendedoresPage currentUser={session.user} companyId={companyContext.companyId} />}
        />
        <Route
          path="/cotizaciones"
          element={
            <CotizacionesPage
              currentUser={session.user}
              companyId={companyContext.companyId}
              company={companyContext.company}
              branding={companyContext.branding}
            />
          }
        />
        <Route
          path="/punto-venta"
          element={
            <PuntoVentaPage
              currentUser={session.user}
              companyId={companyContext.companyId}
              company={companyContext.company}
              branding={companyContext.branding}
            />
          }
        />
        <Route
          path="/reportes"
          element={
            <ReportesPage
              companyId={companyContext.companyId}
              company={companyContext.company}
              branding={companyContext.branding}
            />
          }
        />
        <Route
          path="/soporte"
          element={
            <SoportePage
              currentUser={session.user}
              companyId={companyContext.companyId}
              company={companyContext.company}
            />
          }
        />
        <Route
          path="/administracion"
          element={
            adminContext.isSuperAdmin ? (
              <SuperAdminPage currentUser={session.user} adminContext={adminContext} />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
        <Route
          path="/mesa-tickets"
          element={
            adminContext.isSuperAdmin ? (
              <TicketsAdminPage currentUser={session.user} />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
        <Route
          path="/configuracion"
          element={
            <ConfiguracionPage
              currentUser={session.user}
              companyId={companyContext.companyId}
              company={companyContext.company}
              branding={companyContext.branding}
              onBrandingSaved={setCompanyContext}
            />
          }
        />
      </Routes>
    </AppLayout>
  );
}

export default App;
