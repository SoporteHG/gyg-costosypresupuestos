import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const REQUEST_TIMEOUT_MS = 10000;

const initialForm = {
  asunto: "",
  modulo: "dashboard",
  categoria: "error",
  prioridad: "media",
  descripcion: "",
  pasos: "",
};

const MODULE_OPTIONS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "clientes", label: "Clientes" },
  { value: "productos", label: "Productos" },
  { value: "inventario", label: "Inventario" },
  { value: "proveedores", label: "Proveedores" },
  { value: "vendedores", label: "Vendedores" },
  { value: "cotizaciones", label: "Cotizaciones" },
  { value: "punto-venta", label: "Punto de Venta" },
  { value: "reportes", label: "Reportes" },
  { value: "configuracion", label: "Configuracion" },
  { value: "otro", label: "Otro" },
];

const PRIORITY_META = {
  baja: { label: "Baja", className: "status-chip" },
  media: { label: "Media", className: "status-chip status-chip-warning" },
  alta: { label: "Alta", className: "status-chip status-chip-danger" },
  critica: { label: "Critica", className: "status-chip status-chip-danger" },
};

const STATUS_META = {
  abierto: { label: "Abierto", className: "status-chip status-chip-warning" },
  en_revision: { label: "En revision", className: "status-chip" },
  resuelto: { label: "Resuelto", className: "status-chip status-chip-success" },
  cerrado: { label: "Cerrado", className: "status-chip" },
};

export default function SoportePage({ currentUser, companyId, company }) {
  const [tickets, setTickets] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusDetail, setStatusDetail] = useState("Preparando carga...");

  useEffect(() => {
    loadTickets();
  }, [currentUser?.id, companyId]);

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

  function requireContext() {
    if (!currentUser?.id || !companyId) {
      throw new Error("No se encontro la empresa activa para registrar el ticket.");
    }

    return {
      userId: currentUser.id,
      userEmail: currentUser.email || "",
      tenantId: companyId,
    };
  }

  async function loadTickets() {
    try {
      setLoading(true);
      setErrorMessage("");
      setMessage("");
      setStatusDetail("Consultando tickets...");

      const { userId, tenantId } = requireContext();

      const { data, error } = await withTimeout(
        supabase
          .from("support_tickets")
          .select(
            "id, tenant_id, user_id, user_email, ticket_number, subject, module_name, category, priority, description, repro_steps, status, created_at, updated_at"
          )
          .eq("tenant_id", tenantId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        "consultar tickets de soporte"
      );

      if (error) throw error;

      setTickets(data || []);
      setStatusDetail(`Carga completa: ${data?.length || 0} ticket(s).`);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudieron cargar los tickets de soporte.");
      setStatusDetail("La carga se detuvo.");
    } finally {
      setLoading(false);
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Enviando ticket...");

      const { userId, userEmail, tenantId } = requireContext();

      if (!form.asunto.trim()) {
        throw new Error("El asunto del ticket es obligatorio.");
      }

      if (!form.descripcion.trim()) {
        throw new Error("Describe el problema para que soporte pueda ayudarte.");
      }

      const payload = {
        tenant_id: tenantId,
        user_id: userId,
        user_email: userEmail || null,
        company_name: company?.name || null,
        ticket_number: buildSupportTicketNumber(),
        subject: form.asunto.trim(),
        module_name: form.modulo,
        category: form.categoria,
        priority: form.prioridad,
        description: form.descripcion.trim(),
        repro_steps: form.pasos.trim() || null,
        status: "abierto",
        page_url: typeof window !== "undefined" ? window.location.href : null,
      };

      const { data, error } = await withTimeout(
        supabase
          .from("support_tickets")
          .insert(payload)
          .select(
            "id, tenant_id, user_id, user_email, ticket_number, subject, module_name, category, priority, description, repro_steps, status, created_at, updated_at"
          )
          .single(),
        "crear ticket de soporte"
      );

      if (error) throw error;

      setTickets((previous) => [data, ...previous]);
      setForm(initialForm);
      setMessage("Ticket enviado correctamente. Nuestro equipo podra revisarlo desde administracion.");
      setStatusDetail("Ticket registrado.");
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo enviar el ticket de soporte.");
      setStatusDetail("No se pudo completar el envio.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Soporte</h1>
        <p>Levanta tickets para reportar errores, dudas operativas o solicitudes de mejora dentro de la app.</p>
      </div>

      <div className="support-layout">
        <section className="module-card support-form-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Nuevo ticket</h2>
              <p className="section-copy">
                Entre mas claro quede el problema, mas rapido podremos ayudarte.
              </p>
            </div>
          </div>

          <form className="support-form" onSubmit={handleSubmit}>
            <div className="support-form-grid">
              <div className="form-group form-group-full">
                <label>Asunto</label>
                <input
                  name="asunto"
                  value={form.asunto}
                  onChange={handleChange}
                  placeholder="Ej. No puedo guardar una cotizacion en USD"
                  maxLength={140}
                />
              </div>

              <div className="form-group">
                <label>Modulo afectado</label>
                <select className="quotes-select" name="modulo" value={form.modulo} onChange={handleChange}>
                  {MODULE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Categoria</label>
                <select className="quotes-select" name="categoria" value={form.categoria} onChange={handleChange}>
                  <option value="error">Error</option>
                  <option value="duda">Duda</option>
                  <option value="mejora">Mejora</option>
                  <option value="acceso">Acceso</option>
                </select>
              </div>

              <div className="form-group">
                <label>Prioridad</label>
                <select className="quotes-select" name="prioridad" value={form.prioridad} onChange={handleChange}>
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                  <option value="critica">Critica</option>
                </select>
              </div>
            </div>

            <div className="form-group form-group-full">
              <label>Descripcion del problema</label>
              <textarea
                name="descripcion"
                value={form.descripcion}
                onChange={handleChange}
                rows="4"
                placeholder="Que intentabas hacer, que paso realmente y que esperabas que ocurriera."
              />
            </div>

            <div className="form-group form-group-full">
              <label>Pasos para reproducirlo</label>
              <textarea
                name="pasos"
                value={form.pasos}
                onChange={handleChange}
                rows="3"
                placeholder="1. Entro al modulo... 2. Capturo... 3. Aparece el error..."
              />
            </div>

            <div className="support-help-strip">
              <div>
                <span className="quotes-summary-label">Usuario</span>
                <strong>{currentUser?.email || "Sin correo"}</strong>
              </div>
              <div>
                <span className="quotes-summary-label">Empresa</span>
                <strong>{company?.name || "Sin empresa"}</strong>
              </div>
              <div>
                <span className="quotes-summary-label">Consejo</span>
                <strong>Describe el error y menciona el modulo exacto.</strong>
              </div>
            </div>

            <div className="settings-actions">
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? "Enviando..." : "Levantar ticket"}
              </button>
            </div>

            {errorMessage ? <p className="form-message form-message-error">{errorMessage}</p> : null}
            {message ? <p className="form-message form-message-success">{message}</p> : null}
          </form>
        </section>

        <section className="module-card support-list-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Mis tickets</h2>
              <p className="section-copy">
                {loading ? "Cargando tickets..." : `${tickets.length} ticket(s) registrados.`}
              </p>
              <p className="section-copy">{statusDetail}</p>
            </div>
            <button type="button" className="secondary-btn" onClick={loadTickets} disabled={loading}>
              {loading ? "Actualizando..." : "Recargar"}
            </button>
          </div>

          {!loading && tickets.length === 0 && !errorMessage ? (
            <div className="empty-state">
              <strong>No hay tickets registrados todavia.</strong>
              <span>Cuando levantes uno, aparecera aqui con su prioridad y estatus.</span>
            </div>
          ) : null}

          {tickets.length ? (
            <div className="support-cards-grid">
              {tickets.map((ticket) => {
                const priorityMeta = PRIORITY_META[ticket.priority] || PRIORITY_META.media;
                const statusMeta = STATUS_META[ticket.status] || STATUS_META.abierto;

                return (
                  <article key={ticket.id} className="support-card">
                    <div className="support-card-head">
                      <div>
                        <h3 className="quote-card-title">{ticket.subject}</h3>
                        <p className="quote-card-copy">
                          {ticket.ticket_number || "Sin folio"} | {labelForModule(ticket.module_name)} | {labelForCategory(ticket.category)}
                        </p>
                      </div>
                      <div className="support-card-badges">
                        <span className={priorityMeta.className}>{priorityMeta.label}</span>
                        <span className={statusMeta.className}>{statusMeta.label}</span>
                      </div>
                    </div>

                    <div className="quote-card-meta">
                      <div>
                        <span className="quotes-summary-label">Alta</span>
                        <strong>{formatDate(ticket.created_at)}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Actualizacion</span>
                        <strong>{formatDate(ticket.updated_at)}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Correo</span>
                        <strong>{ticket.user_email || "Sin correo"}</strong>
                      </div>
                    </div>

                    <p className="quote-card-notes">{ticket.description}</p>
                    <p className="quote-card-notes">
                      Pasos: {ticket.repro_steps || "Sin pasos adicionales."}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function labelForModule(value) {
  return MODULE_OPTIONS.find((option) => option.value === value)?.label || "Otro";
}

function labelForCategory(value) {
  const labels = {
    error: "Error",
    duda: "Duda",
    mejora: "Mejora",
    acceso: "Acceso",
  };

  return labels[value] || "General";
}

function formatDate(value) {
  if (!value) return "Sin fecha";

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function buildSupportTicketNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const stamp = now.getTime().toString().slice(-6);
  return `SUP-${year}-${stamp}`;
}
