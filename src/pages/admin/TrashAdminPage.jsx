import { useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";

const REQUEST_TIMEOUT_MS = 8000;

const TRASH_MODULES = [
  {
    key: "clientes",
    label: "Clientes",
    singularLabel: "cliente",
    table: "clientes",
    primaryLabel: "nombre",
    selectColumns: ["id", "tenant_id", "nombre", "empresa", "deleted_at", "deleted_by", "deleted_by_email"],
    summary: (row) => row.empresa || "Sin empresa registrada",
  },
  {
    key: "productos",
    label: "Productos",
    singularLabel: "producto",
    table: "productos",
    primaryLabel: "nombre",
    selectColumns: [
      "id",
      "tenant_id",
      "sku",
      "nombre",
      "categoria",
      "unidad",
      "deleted_at",
      "deleted_by",
      "deleted_by_email",
    ],
    summary: (row) => [row.sku, row.categoria].filter(Boolean).join(" | ") || row.unidad || "Sin referencia",
  },
  {
    key: "proveedores",
    label: "Proveedores",
    singularLabel: "proveedor",
    table: "proveedores",
    primaryLabel: "nombre",
    selectColumns: ["id", "tenant_id", "nombre", "empresa", "contacto", "deleted_at", "deleted_by", "deleted_by_email"],
    summary: (row) => [row.empresa, row.contacto].filter(Boolean).join(" | ") || "Sin referencia",
  },
  {
    key: "vendedores",
    label: "Vendedores",
    singularLabel: "vendedor",
    table: "vendedores",
    primaryLabel: "nombre",
    selectColumns: ["id", "tenant_id", "nombre", "email", "telefono", "deleted_at", "deleted_by", "deleted_by_email"],
    summary: (row) => row.email || row.telefono || "Sin contacto",
  },
  {
    key: "cotizaciones",
    label: "Cotizaciones",
    singularLabel: "cotizacion",
    table: "cotizaciones",
    primaryLabel: "folio",
    selectColumns: [
      "id",
      "tenant_id",
      "folio",
      "cliente_nombre",
      "cliente_empresa",
      "currency_code",
      "total",
      "deleted_at",
      "deleted_by",
      "deleted_by_email",
    ],
    summary: (row) => {
      const clientLabel = row.cliente_empresa || row.cliente_nombre || "Sin cliente";
      const totalLabel = row.total !== null && row.total !== undefined ? formatCurrency(row.total, row.currency_code) : "";
      return [clientLabel, totalLabel].filter(Boolean).join(" | ");
    },
  },
];

export default function TrashAdminPage({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restoringKey, setRestoringKey] = useState("");
  const [activeModule, setActiveModule] = useState(TRASH_MODULES[0].key);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("Cargando papelera...");
  const [recordsByModule, setRecordsByModule] = useState({});
  const [moduleErrors, setModuleErrors] = useState({});
  const [companyNames, setCompanyNames] = useState({});

  useEffect(() => {
    loadTrashData();
  }, []);

  const moduleCounts = useMemo(() => {
    return TRASH_MODULES.reduce((accumulator, module) => {
      accumulator[module.key] = recordsByModule[module.key]?.length || 0;
      return accumulator;
    }, {});
  }, [recordsByModule]);

  const totalDeleted = useMemo(() => {
    return Object.values(moduleCounts).reduce((accumulator, value) => accumulator + value, 0);
  }, [moduleCounts]);

  const activeRows = recordsByModule[activeModule] || [];
  const activeModuleConfig = TRASH_MODULES.find((module) => module.key === activeModule) || TRASH_MODULES[0];

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

  async function fetchDeletedRows(module) {
    const columns = module.selectColumns.join(", ");
    const response = await withTimeout(
      supabase
        .from(module.table)
        .select(columns)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
      `consultar papelera de ${module.label.toLowerCase()}`
    );

    if (response.error) {
      throw response.error;
    }

    return response.data || [];
  }

  async function loadTrashData({ silent = false } = {}) {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorMessage("");
      setStatusMessage("Consultando registros archivados...");

      const [companiesResult, ...moduleResults] = await Promise.allSettled([
        withTimeout(supabase.from("companies").select("id, name"), "consultar empresas"),
        ...TRASH_MODULES.map((module) => fetchDeletedRows(module)),
      ]);

      if (companiesResult.status === "fulfilled") {
        if (companiesResult.value.error) throw companiesResult.value.error;

        setCompanyNames(
          (companiesResult.value.data || []).reduce((accumulator, entry) => {
            accumulator[entry.id] = entry.name;
            return accumulator;
          }, {})
        );
      } else {
        throw companiesResult.reason;
      }

      const nextRecords = {};
      const nextErrors = {};

      moduleResults.forEach((result, index) => {
        const module = TRASH_MODULES[index];

        if (result.status === "fulfilled") {
          nextRecords[module.key] = result.value;
          nextErrors[module.key] = "";
        } else {
          nextRecords[module.key] = [];
          nextErrors[module.key] = result.reason?.message || `No se pudo cargar ${module.label.toLowerCase()}.`;
        }
      });

      setRecordsByModule(nextRecords);
      setModuleErrors(nextErrors);
      setStatusMessage("Papelera actualizada.");
    } catch (error) {
      console.error(error);
      setErrorMessage(
        `${error.message || "No se pudo cargar la papelera."} Verifica que las columnas de soft delete existan en Supabase.`
      );
      setStatusMessage("La papelera requiere configuracion adicional.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleRestore(module, row) {
    const recordLabel = row[module.primaryLabel] || "este registro";
    const confirmed = window.confirm(`Restaurar ${module.singularLabel} "${recordLabel}"?`);

    if (!confirmed) {
      return;
    }

    const actionKey = `${module.key}:${row.id}`;

    try {
      setRestoringKey(actionKey);
      setErrorMessage("");

      const { error } = await withTimeout(
        supabase
          .from(module.table)
          .update({
            deleted_at: null,
            deleted_by: null,
            deleted_by_email: null,
          })
          .eq("id", row.id),
        `restaurar ${module.label.toLowerCase()}`
      );

      if (error) throw error;

      setRecordsByModule((currentValue) => ({
        ...currentValue,
        [module.key]: (currentValue[module.key] || []).filter((entry) => entry.id !== row.id),
      }));
      setStatusMessage(`${capitalize(module.singularLabel)} restaurado correctamente.`);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo restaurar el registro.");
    } finally {
      setRestoringKey("");
    }
  }

  if (loading) {
    return (
      <div className="page-header">
        <h1>Papelera</h1>
        <p>Cargando registros archivados del sistema...</p>
      </div>
    );
  }

  return (
    <div className="reports-shell">
      <div className="page-header">
        <h1>Papelera</h1>
        <p>Recupera clientes, productos, proveedores, vendedores y cotizaciones marcados como eliminados.</p>
      </div>

      {errorMessage ? <div className="form-message form-message-error">{errorMessage}</div> : null}
      {!errorMessage ? <div className="form-message">{statusMessage}</div> : null}

      <section className="module-card trash-hero-card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Resumen de papelera</h2>
            <p className="section-copy">
              Aqui ves todo lo archivado por usuarios. Puedes restaurarlo sin tocar backups ni SQL manual.
            </p>
          </div>

          <button
            type="button"
            className="secondary-btn trash-restore-btn"
            onClick={() => loadTrashData({ silent: true })}
            disabled={refreshing}
          >
            <RefreshCw size={16} />
            {refreshing ? "Actualizando..." : "Actualizar"}
          </button>
        </div>

        <div className="trash-metrics-grid">
          <article className="stat-card">
            <div className="label">Total archivado</div>
            <div className="value">{totalDeleted}</div>
          </article>

          {TRASH_MODULES.map((module) => (
            <button
              key={module.key}
              type="button"
              className={`stat-card stat-card-button ${activeModule === module.key ? "trash-metric-active" : ""}`}
              onClick={() => setActiveModule(module.key)}
            >
              <div className="label">{module.label}</div>
              <div className="value">{moduleCounts[module.key] || 0}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="module-card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Contenido archivado</h2>
            <p className="section-copy">Explora por modulo y restaura solo lo necesario.</p>
          </div>
        </div>

        <div className="trash-tabs" role="tablist" aria-label="Modulos de papelera">
          {TRASH_MODULES.map((module) => (
            <button
              key={module.key}
              type="button"
              className={`trash-tab ${activeModule === module.key ? "trash-tab-active" : ""}`}
              onClick={() => setActiveModule(module.key)}
            >
              <Trash2 size={15} />
              {module.label}
              <span>{moduleCounts[module.key] || 0}</span>
            </button>
          ))}
        </div>

        {moduleErrors[activeModule] ? (
          <div className="empty-state" style={{ marginTop: 18 }}>
            <strong>No se pudo cargar {activeModuleConfig.label.toLowerCase()}.</strong>
            <span>{moduleErrors[activeModule]}</span>
          </div>
        ) : null}

        {!moduleErrors[activeModule] && activeRows.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 18 }}>
            <strong>No hay {activeModuleConfig.label.toLowerCase()} en papelera.</strong>
            <span>Cuando alguien archive un registro de este modulo aparecera aqui.</span>
          </div>
        ) : null}

        {!moduleErrors[activeModule] && activeRows.length > 0 ? (
          <div className="trash-records">
            {activeRows.map((row) => {
              const actionKey = `${activeModule}:${row.id}`;
              const companyName = companyNames[row.tenant_id] || "Empresa no identificada";
              const deletedBy = row.deleted_by_email || row.deleted_by || "Sin registro";
              const title = row[activeModuleConfig.primaryLabel] || "Sin titulo";

              return (
                <article key={row.id} className="trash-record">
                  <div className="trash-record-head">
                    <div>
                      <h3 className="trash-record-title">{title}</h3>
                      <p className="trash-record-summary">{activeModuleConfig.summary(row)}</p>
                    </div>

                    <div className="trash-record-head-actions">
                      <span className="status-chip">{activeModuleConfig.label}</span>
                      <button
                        type="button"
                        className="secondary-btn trash-restore-btn"
                        onClick={() => handleRestore(activeModuleConfig, row)}
                        disabled={restoringKey === actionKey}
                      >
                        <RotateCcw size={15} />
                        {restoringKey === actionKey ? "Restaurando..." : "Restaurar"}
                      </button>
                    </div>
                  </div>

                  <div className="trash-record-meta">
                    <div className="trash-record-field">
                      <span>Empresa</span>
                      <strong>{companyName}</strong>
                    </div>
                    <div className="trash-record-field">
                      <span>Borrado el</span>
                      <strong>{formatDate(row.deleted_at)}</strong>
                    </div>
                    <div className="trash-record-field">
                      <span>Borrado por</span>
                      <strong>{deletedBy}</strong>
                    </div>
                    <div className="trash-record-field">
                      <span>ID</span>
                      <strong>{row.id}</strong>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="module-card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Como opera la papelera</h2>
            <p className="section-copy">Esta vista no borra definitivamente. Solo recupera registros archivados.</p>
          </div>
        </div>

        <div className="dashboard-kpi-list">
          <div className="dashboard-kpi-row">
            <span>Soft delete activo</span>
            <strong>Clientes, productos, proveedores, vendedores y cotizaciones</strong>
          </div>
          <div className="dashboard-kpi-row">
            <span>Recuperacion</span>
            <strong>Restauracion inmediata sin backup completo</strong>
          </div>
          <div className="dashboard-kpi-row">
            <span>Trazabilidad</span>
            <strong>{currentUser?.email || "Super Admin"} puede ver fecha y correo de borrado</strong>
          </div>
        </div>
      </section>
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

function formatCurrency(value, currencyCode = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currencyCode || "MXN",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function capitalize(value) {
  if (!value) return "";
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
