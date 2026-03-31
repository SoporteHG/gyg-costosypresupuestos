import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { getCurrentCompanyContext } from "./lib/company";
import { Routes, Route, Navigate } from "react-router-dom";

import AppLayout from "./components/layout/AppLayout";
import DashboardPage from "./pages/dashboard/DashboardPage";
import ClientesPage from "./pages/clientes/ClientesManagerPage";
import ProductosPage from "./pages/productos/ProductosPage";
import InventarioPage from "./pages/inventario/InventarioPage";
import ProveedoresPage from "./pages/proveedores/ProveedoresPage";
import CotizacionesPage from "./pages/cotizaciones/CotizacionesPage";
import PuntoVentaPage from "./pages/ventas/PuntoVentaPage";
import ReportesPage from "./pages/reportes/ReportesPage";
import ConfiguracionPage from "./pages/settings/ConfiguracionPage";
import LoginPage from "./pages/auth/LoginPage";

function App() {
  const [session, setSession] = useState(undefined);
  const [companyContext, setCompanyContext] = useState(null);
  const [companyContextError, setCompanyContextError] = useState("");
  const isLoadingCompanyRef = useRef(false);

  function handleLoggedOut() {
    setSession(null);
    setCompanyContext(null);
    setCompanyContextError("");
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        await loadCompanyContext(data.session.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session?.user) {
        await loadCompanyContext(session.user.id);
      } else {
        setCompanyContext(null);
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
