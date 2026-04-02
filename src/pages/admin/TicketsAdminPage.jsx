import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const REQUEST_TIMEOUT_MS = 8000;
const OPEN_STATUSES = ["abierto"];
const PENDING_STATUSES = ["en_revision", "esperando_usuario"];
const CLOSED_STATUSES = ["resuelto", "cerrado"];

export default function TicketsAdminPage({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [savingTicketId, setSavingTicketId] = useState("");
  const [expandedTickets, setExpandedTickets] = useState({});
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("Preparando mesa de tickets...");
  const [tickets, setTickets] = useState([]);
  const [ticketUpdates, setTicketUpdates] = useState([]);
  const [ticketForms, setTicketForms] = useState({});
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadTicketsDesk();
  }, [currentUser?.id]);

  const updatesByTicket = useMemo(() => {
    return ticketUpdates.reduce((accumulator, entry) => {
      if (!accumulator[entry.ticket_id]) {
        accumulator[entry.ticket_id] = [];
      }
      accumulator[entry.ticket_id].push(entry);
      return accumulator;
    }, {});
  }, [ticketUpdates]);

  const visibleTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const haystack = [
        ticket.ticket_number,
        ticket.subject,
        ticket.user_email,
        ticket.company_name,
        ticket.module_name,
      ]
        .join(" ")
        .toLowerCase();

      return searchTerm.trim() ? haystack.includes(searchTerm.trim().toLowerCase()) : true;
    });
  }, [tickets, searchTerm]);

  const openTickets = useMemo(
    () => visibleTickets.filter((ticket) => OPEN_STATUSES.includes(ticket.status)),
    [visibleTickets]
  );

  const pendingTickets = useMemo(
    () => visibleTickets.filter((ticket) => PENDING_STATUSES.includes(ticket.status)),
    [visibleTickets]
  );

  const closedTickets = useMemo(
    () => visibleTickets.filter((ticket) => CLOSED_STATUSES.includes(ticket.status)),
    [visibleTickets]
  );

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

  async function loadTicketsDesk() {
    try {
      setLoading(true);
      setErrorMessage("");
      setStatusMessage("Consultando tickets y seguimiento...");

      const [ticketsResponse, updatesResponse] = await Promise.all([
        withTimeout(
          supabase
            .from("support_tickets")
            .select(
              "id, ticket_number, company_name, user_email, subject, module_name, priority, status, created_at, updated_at, assigned_email, resolution_summary"
            )
            .order("created_at", { ascending: false })
            .limit(100),
          "consultar support_tickets"
        ),
        withTimeout(
          supabase
            .from("support_ticket_updates")
            .select(
              "id, ticket_id, author_email, author_role, previous_status, new_status, message, is_internal, created_at"
            )
            .order("created_at", { ascending: false })
            .limit(300),
          "consultar support_ticket_updates"
        ),
      ]);

      if (ticketsResponse.error) throw ticketsResponse.error;
      if (updatesResponse.error) throw updatesResponse.error;

      setTickets(ticketsResponse.data || []);
      setTicketUpdates(updatesResponse.data || []);
      setTicketForms((currentValue) => {
        const nextValue = { ...currentValue };

        (ticketsResponse.data || []).forEach((ticket) => {
          if (!nextValue[ticket.id]) {
            nextValue[ticket.id] = {
              status: ticket.status || "abierto",
              message: "",
              isInternal: false,
            };
          }
        });

        return nextValue;
      });
      setStatusMessage(`Carga completa: ${ticketsResponse.data?.length || 0} ticket(s).`);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo cargar la mesa de tickets.");
      setStatusMessage("La carga se detuvo.");
    } finally {
      setLoading(false);
    }
  }

  function updateTicketForm(ticketId, field, value) {
    setTicketForms((currentValue) => ({
      ...currentValue,
      [ticketId]: {
        status: currentValue[ticketId]?.status || "abierto",
        message: currentValue[ticketId]?.message || "",
        isInternal: currentValue[ticketId]?.isInternal || false,
        [field]: value,
      },
    }));
  }

  async function handleTicketUpdate(ticket) {
    const ticketForm = ticketForms[ticket.id] || {
      status: ticket.status || "abierto",
      message: "",
      isInternal: false,
    };
    const nextStatus = ticketForm.status || ticket.status || "abierto";
    const trimmedMessage = ticketForm.message?.trim() || "";
    const statusChanged = nextStatus !== ticket.status;

    if (!statusChanged && !trimmedMessage) {
      setErrorMessage("Agrega un comentario o cambia el estatus antes de actualizar el ticket.");
      return;
    }

    try {
      setSavingTicketId(ticket.id);
      setErrorMessage("");

      const updatePayload = {
        status: nextStatus,
        assigned_to: currentUser?.id || null,
        assigned_email: currentUser?.email || null,
      };

      if ((nextStatus === "resuelto" || nextStatus === "cerrado") && trimmedMessage) {
        updatePayload.resolution_summary = trimmedMessage;
        if (nextStatus === "cerrado") {
          updatePayload.closed_at = new Date().toISOString();
        }
      }

      const { data: updatedTicket, error: updateError } = await supabase
        .from("support_tickets")
        .update(updatePayload)
        .eq("id", ticket.id)
        .select(
          "id, ticket_number, company_name, user_email, subject, module_name, priority, status, created_at, updated_at, assigned_email, resolution_summary"
        )
        .single();

      if (updateError) throw updateError;

      let newUpdateEntry = null;
      if (trimmedMessage || statusChanged) {
        const { data: insertedUpdate, error: insertError } = await supabase
          .from("support_ticket_updates")
          .insert({
            ticket_id: ticket.id,
            author_user_id: currentUser?.id || null,
            author_email: currentUser?.email || null,
            author_role: "super_admin",
            previous_status: ticket.status || null,
            new_status: nextStatus,
            message: trimmedMessage || `Estatus actualizado a ${supportStatusLabel(nextStatus)}.`,
            is_internal: !!ticketForm.isInternal,
          })
          .select(
            "id, ticket_id, author_email, author_role, previous_status, new_status, message, is_internal, created_at"
          )
          .single();

        if (insertError) throw insertError;
        newUpdateEntry = insertedUpdate;
      }

      setTickets((currentValue) =>
        currentValue.map((entry) => (entry.id === ticket.id ? updatedTicket : entry))
      );

      if (newUpdateEntry) {
        setTicketUpdates((currentValue) => [newUpdateEntry, ...currentValue]);
      }

      setTicketForms((currentValue) => ({
        ...currentValue,
        [ticket.id]: {
          status: nextStatus,
          message: "",
          isInternal: false,
        },
      }));
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo actualizar el ticket.");
    } finally {
      setSavingTicketId("");
    }
  }

  function toggleTicket(ticketId) {
    setExpandedTickets((currentValue) => ({
      ...currentValue,
      [ticketId]: !currentValue[ticketId],
    }));
  }

  return (
    <div>
      <div className="page-header">
        <h1>Mesa de tickets</h1>
        <p>Organiza la atencion en tres bandejas claras: abiertos, pending y cerrados.</p>
      </div>

      <section className="module-card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Centro de atencion</h2>
            <p className="section-copy">{statusMessage}</p>
          </div>
          <button type="button" className="secondary-btn" onClick={loadTicketsDesk} disabled={loading}>
            {loading ? "Actualizando..." : "Recargar"}
          </button>
        </div>

        <div className="support-form-grid">
          <div className="form-group">
            <label>Buscar ticket</label>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Folio, asunto, correo, empresa o modulo"
            />
          </div>
        </div>

        {errorMessage ? <p className="form-message form-message-error">{errorMessage}</p> : null}

        <div className="tickets-desk-sections">
          <section className="tickets-desk-section">
            <div className="tickets-desk-section-head">
              <div>
                <h3>Tickets abiertos</h3>
                <p>{openTickets.length} ticket(s) nuevos por atender</p>
              </div>
            </div>

            {openTickets.length > 0 ? (
              <div className="support-cards-grid admin-support-grid">
                {openTickets.map((ticket) => (
                  <article key={ticket.id} className="support-card admin-ticket-card admin-ticket-card-minimal">
                    <div className="support-card-head">
                      <div>
                        <h3 className="quote-card-title">{ticket.ticket_number || "Sin folio"}</h3>
                        <p className="quote-card-copy">{ticket.subject || "Ticket sin asunto"}</p>
                        <p className="quote-card-copy">
                          {ticket.user_email || "Sin correo"} | {ticket.company_name || "Sin empresa"}
                        </p>
                      </div>
                      <div className="support-card-badges">
                        <span className={`status-chip ${supportPriorityClass(ticket.priority)}`}>
                          {supportPriorityLabel(ticket.priority)}
                        </span>
                        <span className={`status-chip ${supportStatusClass(ticket.status)}`}>
                          {supportStatusLabel(ticket.status)}
                        </span>
                        <button
                          type="button"
                          className="ticket-expand-btn"
                          onClick={() => toggleTicket(ticket.id)}
                          aria-expanded={!!expandedTickets[ticket.id]}
                        >
                          {expandedTickets[ticket.id] ? "Ocultar" : "Ver"}
                          <span className={`ticket-expand-arrow ${expandedTickets[ticket.id] ? "is-open" : ""}`}>
                            v
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="quote-card-meta admin-ticket-meta-compact">
                      <div>
                        <span className="quotes-summary-label">Modulo</span>
                        <strong>{ticket.module_name || "general"}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Asignado</span>
                        <strong>{ticket.assigned_email || "Sin asignar"}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Actualizacion</span>
                        <strong>{formatDate(ticket.updated_at)}</strong>
                      </div>
                    </div>

                    {expandedTickets[ticket.id] ? (
                      <>
                        <div className="admin-ticket-form">
                          <div className="form-group">
                            <label>Estatus</label>
                            <select
                              className="quotes-select"
                              value={ticketForms[ticket.id]?.status || ticket.status || "abierto"}
                              onChange={(event) => updateTicketForm(ticket.id, "status", event.target.value)}
                            >
                              <option value="abierto">Abierto</option>
                              <option value="en_revision">En revision</option>
                              <option value="esperando_usuario">Esperando usuario</option>
                              <option value="resuelto">Resuelto</option>
                              <option value="cerrado">Cerrado</option>
                            </select>
                          </div>

                          <div className="form-group form-group-full">
                            <label>Respuesta / seguimiento</label>
                            <textarea
                              rows="3"
                              value={ticketForms[ticket.id]?.message || ""}
                              onChange={(event) => updateTicketForm(ticket.id, "message", event.target.value)}
                              placeholder="Describe la accion realizada, dudas o resolucion del caso..."
                            />
                          </div>

                          <label className="admin-ticket-internal">
                            <input
                              type="checkbox"
                              checked={ticketForms[ticket.id]?.isInternal || false}
                              onChange={(event) => updateTicketForm(ticket.id, "isInternal", event.target.checked)}
                            />
                            Nota interna
                          </label>

                          <div className="settings-actions">
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={() => handleTicketUpdate(ticket)}
                              disabled={savingTicketId === ticket.id}
                            >
                              {savingTicketId === ticket.id ? "Guardando..." : "Actualizar ticket"}
                            </button>
                          </div>
                        </div>

                        <TicketTimeline updates={updatesByTicket[ticket.id] || []} />
                      </>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No hay tickets abiertos.</strong>
                <span>La bandeja principal esta despejada por ahora.</span>
              </div>
            )}
          </section>

          <section className="tickets-desk-section">
            <div className="tickets-desk-section-head">
              <div>
                <h3>Tickets pending</h3>
                <p>{pendingTickets.length} ticket(s) en revision o esperando usuario</p>
              </div>
            </div>

            {pendingTickets.length > 0 ? (
              <div className="support-cards-grid admin-support-grid">
                {pendingTickets.map((ticket) => (
                  <article key={ticket.id} className="support-card admin-ticket-card admin-ticket-card-minimal">
                    <div className="support-card-head">
                      <div>
                        <h3 className="quote-card-title">{ticket.ticket_number || "Sin folio"}</h3>
                        <p className="quote-card-copy">{ticket.subject || "Ticket sin asunto"}</p>
                        <p className="quote-card-copy">
                          {ticket.user_email || "Sin correo"} | {ticket.company_name || "Sin empresa"}
                        </p>
                      </div>
                      <div className="support-card-badges">
                        <span className={`status-chip ${supportPriorityClass(ticket.priority)}`}>
                          {supportPriorityLabel(ticket.priority)}
                        </span>
                        <span className={`status-chip ${supportStatusClass(ticket.status)}`}>
                          {supportStatusLabel(ticket.status)}
                        </span>
                        <button
                          type="button"
                          className="ticket-expand-btn"
                          onClick={() => toggleTicket(ticket.id)}
                          aria-expanded={!!expandedTickets[ticket.id]}
                        >
                          {expandedTickets[ticket.id] ? "Ocultar" : "Ver"}
                          <span className={`ticket-expand-arrow ${expandedTickets[ticket.id] ? "is-open" : ""}`}>
                            v
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="quote-card-meta admin-ticket-meta-compact">
                      <div>
                        <span className="quotes-summary-label">Modulo</span>
                        <strong>{ticket.module_name || "general"}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Asignado</span>
                        <strong>{ticket.assigned_email || "Sin asignar"}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Actualizacion</span>
                        <strong>{formatDate(ticket.updated_at)}</strong>
                      </div>
                    </div>

                    {expandedTickets[ticket.id] ? (
                      <>
                        <div className="admin-ticket-form">
                          <div className="form-group">
                            <label>Estatus</label>
                            <select
                              className="quotes-select"
                              value={ticketForms[ticket.id]?.status || ticket.status || "abierto"}
                              onChange={(event) => updateTicketForm(ticket.id, "status", event.target.value)}
                            >
                              <option value="abierto">Abierto</option>
                              <option value="en_revision">En revision</option>
                              <option value="esperando_usuario">Esperando usuario</option>
                              <option value="resuelto">Resuelto</option>
                              <option value="cerrado">Cerrado</option>
                            </select>
                          </div>

                          <div className="form-group form-group-full">
                            <label>Respuesta / seguimiento</label>
                            <textarea
                              rows="3"
                              value={ticketForms[ticket.id]?.message || ""}
                              onChange={(event) => updateTicketForm(ticket.id, "message", event.target.value)}
                              placeholder="Describe la accion realizada, dudas o resolucion del caso..."
                            />
                          </div>

                          <label className="admin-ticket-internal">
                            <input
                              type="checkbox"
                              checked={ticketForms[ticket.id]?.isInternal || false}
                              onChange={(event) => updateTicketForm(ticket.id, "isInternal", event.target.checked)}
                            />
                            Nota interna
                          </label>

                          <div className="settings-actions">
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={() => handleTicketUpdate(ticket)}
                              disabled={savingTicketId === ticket.id}
                            >
                              {savingTicketId === ticket.id ? "Guardando..." : "Actualizar ticket"}
                            </button>
                          </div>
                        </div>

                        <TicketTimeline updates={updatesByTicket[ticket.id] || []} />
                      </>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No hay tickets pending.</strong>
                <span>Cuando un caso pase a revision aparecera aqui.</span>
              </div>
            )}
          </section>

          <section className="tickets-desk-section">
            <div className="tickets-desk-section-head">
              <div>
                <h3>Tickets cerrados</h3>
                <p>{closedTickets.length} ticket(s) en historial reciente</p>
              </div>
            </div>

            {closedTickets.length > 0 ? (
              <div className="support-cards-grid admin-support-grid">
                {closedTickets.map((ticket) => (
                  <article key={ticket.id} className="support-card admin-ticket-card admin-ticket-card-minimal">
                    <div className="support-card-head">
                      <div>
                        <h3 className="quote-card-title">{ticket.ticket_number || "Sin folio"}</h3>
                        <p className="quote-card-copy">{ticket.subject || "Ticket sin asunto"}</p>
                        <p className="quote-card-copy">
                          {ticket.user_email || "Sin correo"} | {ticket.company_name || "Sin empresa"}
                        </p>
                      </div>
                      <div className="support-card-badges">
                        <span className={`status-chip ${supportPriorityClass(ticket.priority)}`}>
                          {supportPriorityLabel(ticket.priority)}
                        </span>
                        <span className={`status-chip ${supportStatusClass(ticket.status)}`}>
                          {supportStatusLabel(ticket.status)}
                        </span>
                        <button
                          type="button"
                          className="ticket-expand-btn"
                          onClick={() => toggleTicket(ticket.id)}
                          aria-expanded={!!expandedTickets[ticket.id]}
                        >
                          {expandedTickets[ticket.id] ? "Ocultar" : "Ver"}
                          <span className={`ticket-expand-arrow ${expandedTickets[ticket.id] ? "is-open" : ""}`}>
                            v
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="quote-card-meta admin-ticket-meta-compact">
                      <div>
                        <span className="quotes-summary-label">Modulo</span>
                        <strong>{ticket.module_name || "general"}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Asignado</span>
                        <strong>{ticket.assigned_email || "Sin asignar"}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Actualizacion</span>
                        <strong>{formatDate(ticket.updated_at)}</strong>
                      </div>
                    </div>

                    {expandedTickets[ticket.id] ? (
                      <>
                        {ticket.resolution_summary ? (
                          <p className="quote-card-notes">Resolucion: {ticket.resolution_summary}</p>
                        ) : null}

                        <TicketTimeline updates={updatesByTicket[ticket.id] || []} />
                      </>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No hay tickets cerrados para mostrar.</strong>
                <span>Cuando resuelvas casos apareceran aqui.</span>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function TicketTimeline({ updates }) {
  return (
    <div className="admin-ticket-timeline">
      <span className="quotes-summary-label">Seguimiento</span>
      {updates.length > 0 ? (
        <div className="admin-ticket-updates">
          {updates.slice(0, 5).map((entry) => (
            <article key={entry.id} className="admin-ticket-update">
              <div className="admin-ticket-update-head">
                <strong>{entry.author_email || entry.author_role || "Sistema"}</strong>
                <span>{formatDate(entry.created_at)}</span>
              </div>
              <p>{entry.message}</p>
              <div className="admin-ticket-update-meta">
                {entry.previous_status || entry.new_status ? (
                  <span>
                    {supportStatusLabel(entry.previous_status || "abierto")} a {supportStatusLabel(entry.new_status || "abierto")}
                  </span>
                ) : null}
                {entry.is_internal ? <span>Interno</span> : <span>Visible al usuario</span>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="quote-card-notes">Todavia no hay seguimiento registrado.</p>
      )}
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

function supportPriorityLabel(priority) {
  if (priority === "critica") return "Critica";
  if (priority === "alta") return "Alta";
  if (priority === "baja") return "Baja";
  return "Media";
}

function supportPriorityClass(priority) {
  if (priority === "critica" || priority === "alta") return "status-chip-danger";
  if (priority === "baja") return "status-chip";
  return "status-chip-warning";
}

function supportStatusLabel(status) {
  if (status === "esperando_usuario") return "Esperando usuario";
  if (status === "en_revision") return "En revision";
  if (status === "resuelto") return "Resuelto";
  if (status === "cerrado") return "Cerrado";
  return "Abierto";
}

function supportStatusClass(status) {
  if (status === "resuelto" || status === "cerrado") return "status-chip-success";
  if (status === "esperando_usuario") return "status-chip-danger";
  if (status === "en_revision") return "status-chip";
  return "status-chip-warning";
}
