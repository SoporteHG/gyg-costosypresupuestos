import { useEffect, useMemo, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { supabase } from "../../lib/supabase";

const REQUEST_TIMEOUT_MS = 8000;

export default function SuperAdminPage({ currentUser, adminContext }) {
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("Preparando panel administrativo...");
  const [companies, setCompanies] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    loadAdminData();
  }, [currentUser?.id]);

  const metrics = useMemo(() => {
    const pendingCompanies = companies.filter((entry) => entry.status === "pending");
    const activeCompanies = companies.filter((entry) => entry.status === "active");
    const suspendedCompanies = companies.filter((entry) => entry.status === "suspended");

    return {
      totalCompanies: companies.length,
      pendingCompanies: pendingCompanies.length,
      activeCompanies: activeCompanies.length,
      suspendedCompanies: suspendedCompanies.length,
      adminUsers: admins.length,
      accessLogs: logs.length,
    };
  }, [companies, admins, logs]);

  async function withTimeout(promise, label) {
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(`Tiempo de espera agotado en ${label}.`));
      }, REQUEST_TIMEOUT_MS);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function loadAdminData() {
    try {
      setLoading(true);
      setErrorMessage("");
      setStatusMessage("Consultando empresas, administradores y accesos...");

      const [companiesResult, adminsResult, logsResult] = await Promise.allSettled([
        withTimeout(
          supabase
            .from("admin_company_access")
            .select("company_id, company_name, owner_email, status, business_type, created_at")
            .order("created_at", { ascending: false })
            .limit(20),
          "consultar admin_company_access"
        ),
        withTimeout(
          supabase
            .from("platform_admins")
            .select("user_id, email, role, status, created_at")
            .order("created_at", { ascending: false })
            .limit(20),
          "consultar platform_admins"
        ),
        withTimeout(
          supabase
            .from("access_audit_logs")
            .select("id, user_email, event_type, created_at, company_name")
            .order("created_at", { ascending: false })
            .limit(20),
          "consultar access_audit_logs"
        ),
      ]);

      const failureMessage = [companiesResult, adminsResult, logsResult]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message)
        .find(Boolean);

      const companiesResponse = companiesResult.status === "fulfilled" ? companiesResult.value : null;
      const adminsResponse = adminsResult.status === "fulfilled" ? adminsResult.value : null;
      const logsResponse = logsResult.status === "fulfilled" ? logsResult.value : null;

      if (companiesResponse?.error) throw companiesResponse.error;
      if (adminsResponse?.error) throw adminsResponse.error;
      if (logsResponse?.error) throw logsResponse.error;

      setCompanies(
        (companiesResponse?.data || []).map((entry) => ({
          id: entry.company_id,
          name: entry.company_name,
          owner_email: entry.owner_email,
          status: entry.status,
          business_type: entry.business_type,
          created_at: entry.created_at,
        }))
      );
      setAdmins(adminsResponse?.data || []);
      setLogs(logsResponse?.data || []);
      setStatusMessage("Panel administrativo actualizado.");

      if (failureMessage) {
        setErrorMessage(
          `${failureMessage} Si es la primera vez, ejecuta el SQL del modulo de Super Admin para habilitar tablas, vista y permisos.`
        );
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(
        `${error.message || "No se pudo cargar el panel administrativo."} Ejecuta el SQL de Super Admin en Supabase para habilitar este modulo.`
      );
      setStatusMessage("El panel requiere configuracion adicional.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleCompanyAccess(company) {
    const nextStatus = company.status === "active" ? "suspended" : "active";

    try {
      setErrorMessage("");

      const { error } = await supabase
        .from("companies")
        .update({ status: nextStatus })
        .eq("id", company.id);

      if (error) throw error;

      setCompanies((currentValue) =>
        currentValue.map((entry) =>
          entry.id === company.id
            ? {
                ...entry,
                status: nextStatus,
              }
            : entry
        )
      );
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo actualizar el acceso de la empresa.");
    }
  }

  return (
    <div className="reports-shell">
      <div className="page-header">
        <h1>Administracion</h1>
        <p>Control central del sistema, accesos y validacion operativa de empresas.</p>
      </div>

      <section className="module-card admin-hero-card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Super Admin activo</h2>
            <p className="section-copy">
              Tu acceso maestro puede revisar empresas, usuarios privilegiados y actividad de ingreso.
            </p>
          </div>
          <button type="button" className="secondary-btn" onClick={loadAdminData} disabled={loading}>
            {loading ? "Actualizando..." : "Recargar"}
          </button>
        </div>

        <div className="admin-hero-grid">
          <div className="admin-hero-tile">
            <span className="quotes-summary-label">Correo maestro</span>
            <strong>{currentUser?.email || "Sin correo"}</strong>
          </div>
          <div className="admin-hero-tile">
            <span className="quotes-summary-label">Rol</span>
            <strong>{adminContext?.role || "super_admin"}</strong>
          </div>
          <div className="admin-hero-tile">
            <span className="quotes-summary-label">Fuente</span>
            <strong>{adminContext?.source || "fallback-email"}</strong>
          </div>
          <div className="admin-hero-tile">
            <span className="quotes-summary-label">Estado</span>
            <strong>{statusMessage}</strong>
          </div>
        </div>
      </section>

      {errorMessage ? <p className="form-message form-message-error">{errorMessage}</p> : null}

      <div className="dashboard-metrics-grid">
        <div className="stat-card">
          <div className="label">Empresas registradas</div>
          <div className="value">{metrics.totalCompanies}</div>
        </div>
        <div className="stat-card warning">
          <div className="label">Pendientes de validar</div>
          <div className="value">{metrics.pendingCompanies}</div>
        </div>
        <div className="stat-card success">
          <div className="label">Empresas activas</div>
          <div className="value">{metrics.activeCompanies}</div>
        </div>
        <div className="stat-card danger">
          <div className="label">Suspendidas</div>
          <div className="value">{metrics.suspendedCompanies}</div>
        </div>
      </div>

      <div className="dashboard-shell">
        <section className="module-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Empresas recientes</h2>
              <p className="section-copy">Aqui luego validaremos altas nuevas, vencimientos y bloqueos.</p>
            </div>
          </div>

          {companies.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Correo principal</th>
                    <th>Tipo</th>
                    <th>Estatus</th>
                    <th>Alta</th>
                    <th>Acceso</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <tr key={company.id}>
                      <td>{company.name}</td>
                      <td>{company.owner_email || "Sin correo"}</td>
                      <td>{company.business_type || "general"}</td>
                      <td>
                        <span className={`status-chip ${companyStatusClass(company.status)}`}>
                          {companyStatusLabel(company.status)}
                        </span>
                      </td>
                      <td>{formatDate(company.created_at)}</td>
                      <td>
                        <button
                          type="button"
                          className={`table-action-btn ${company.status === "active" ? "table-action-btn-danger" : ""}`}
                          onClick={() => toggleCompanyAccess(company)}
                          title={company.status === "active" ? "Suspender acceso" : "Reactivar acceso"}
                        >
                          {company.status === "active" ? <Lock size={16} /> : <LockOpen size={16} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <strong>No hay empresas visibles todavia.</strong>
              <span>Cuando corras el SQL de Super Admin podras listar y administrar altas nuevas aqui.</span>
            </div>
          )}
        </section>

        <aside className="dashboard-side-stack">
          <section className="module-card">
            <div className="section-head dashboard-side-head">
              <div>
                <h2 className="section-title">Admins de plataforma</h2>
                <p className="section-copy">Usuarios con permiso global del sistema.</p>
              </div>
            </div>

            {admins.length > 0 ? (
              <div className="dashboard-list">
                {admins.map((admin) => (
                  <article key={`${admin.user_id}-${admin.role}`} className="dashboard-list-item">
                    <div>
                      <strong>{admin.email || admin.user_id}</strong>
                      <p>{admin.role}</p>
                    </div>
                    <div className="dashboard-list-meta">
                      <span className={`status-chip ${admin.status === "active" ? "status-chip-success" : "status-chip-danger"}`}>
                        {admin.status || "active"}
                      </span>
                      <span>{formatDate(admin.created_at)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No hay administradores cargados.</strong>
                <span>Tu correo actual seguira entrando como respaldo hasta registrar la tabla.</span>
              </div>
            )}
          </section>

          <section className="module-card">
            <div className="section-head dashboard-side-head">
              <div>
                <h2 className="section-title">Accesos recientes</h2>
                <p className="section-copy">Base para auditar quien entra al sistema.</p>
              </div>
            </div>

            {logs.length > 0 ? (
              <div className="dashboard-list">
                {logs.map((log) => (
                  <article key={log.id} className="dashboard-list-item">
                    <div>
                      <strong>{log.user_email || "Usuario"}</strong>
                      <p>{log.company_name || "Sin empresa"}</p>
                    </div>
                    <div className="dashboard-list-meta">
                      <span>{log.event_type || "login"}</span>
                      <span>{formatDate(log.created_at)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No hay bitacora todavia.</strong>
                <span>En la siguiente fase registraremos los accesos para soporte y seguridad.</span>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function companyStatusLabel(status) {
  if (status === "active") return "Activa";
  if (status === "pending") return "Pendiente";
  if (status === "suspended") return "Suspendida";
  if (status === "expired") return "Vencida";
  return status || "Sin definir";
}

function companyStatusClass(status) {
  if (status === "active") return "status-chip-success";
  if (status === "pending") return "status-chip-warning";
  return "status-chip-danger";
}
