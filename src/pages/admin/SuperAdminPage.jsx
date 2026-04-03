import { useEffect, useMemo, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

const REQUEST_TIMEOUT_MS = 8000;
const PLAN_PRICES = {
  trial: 0,
  monthly: 399,
  yearly: 3600,
};

export default function SuperAdminPage({ currentUser, adminContext }) {
  const navigate = useNavigate();
  const [companyForm, setCompanyForm] = useState({
    companyName: "",
    ownerEmail: "",
    businessType: "general",
    makeDefault: false,
  });
  const [loading, setLoading] = useState(true);
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("Preparando panel administrativo...");
  const [companies, setCompanies] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [logs, setLogs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [liveUsers, setLiveUsers] = useState([]);
  const [dailyUsers, setDailyUsers] = useState([]);
  const [usageReport, setUsageReport] = useState([]);
  const [ticketUpdates, setTicketUpdates] = useState([]);
  const [ticketForms, setTicketForms] = useState({});
  const [subscriptionForms, setSubscriptionForms] = useState({});
  const [savingTicketId, setSavingTicketId] = useState("");
  const [savingSubscriptionId, setSavingSubscriptionId] = useState("");

  useEffect(() => {
    loadAdminData();
  }, [currentUser?.id]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadAdminData();
    }, 60000);

    return () => window.clearInterval(intervalId);
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

  const subscriptionRows = useMemo(() => {
    const subscriptionsByCompany = new Map(subscriptions.map((entry) => [entry.company_id, entry]));
    return companies.map((company) => {
      const subscription = subscriptionsByCompany.get(company.id);
      return (
        subscription || {
          company_id: company.id,
          company_name: company.name,
          owner_email: company.owner_email,
          plan_code: "trial",
          plan_name: "Prueba gratis",
          price_mxn: 0,
          payment_method: "transferencia",
          status: "active",
          trial_ends_at: null,
          starts_at: null,
          expires_at: null,
          grace_until: null,
          notes: "",
          updated_at: company.created_at,
        }
      );
    });
  }, [companies, subscriptions]);

  const metrics = useMemo(() => {
    const pendingCompanies = companies.filter((entry) => entry.status === "pending");
    const activeCompanies = companies.filter((entry) => entry.status === "active");
    const suspendedCompanies = companies.filter((entry) => entry.status === "suspended");
    const openTickets = tickets.filter((entry) => entry.status === "abierto");
    const criticalTickets = tickets.filter((entry) => entry.priority === "critica" || entry.priority === "alta");
    const trialCompanies = subscriptionRows.filter((entry) => entry.plan_code === "trial");
    const monthlyCompanies = subscriptionRows.filter((entry) => entry.plan_code === "monthly");
    const yearlyCompanies = subscriptionRows.filter((entry) => entry.plan_code === "yearly");
    const expiredPlans = subscriptionRows.filter((entry) => isSubscriptionExpired(entry));
    const uniqueOnlineCompanies = new Set(liveUsers.map((entry) => entry.company_id).filter(Boolean));
    const todayMinutes = dailyUsers.reduce((accumulator, entry) => accumulator + Number(entry.minutes_online || 0), 0);

    return {
      totalCompanies: companies.length,
      pendingCompanies: pendingCompanies.length,
      activeCompanies: activeCompanies.length,
      suspendedCompanies: suspendedCompanies.length,
      adminUsers: admins.length,
      accessLogs: logs.length,
      openTickets: openTickets.length,
      criticalTickets: criticalTickets.length,
      trialCompanies: trialCompanies.length,
      monthlyCompanies: monthlyCompanies.length,
      yearlyCompanies: yearlyCompanies.length,
      expiredPlans: expiredPlans.length,
      onlineUsers: liveUsers.length,
      onlineCompanies: uniqueOnlineCompanies.size,
      todayHours: Math.round((todayMinutes / 60) * 10) / 10,
    };
  }, [companies, admins, logs, tickets, subscriptionRows, liveUsers, dailyUsers]);

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

      const today = getTodayStamp();

      const [
        companiesResult,
        adminsResult,
        logsResult,
        ticketsResult,
        subscriptionsResult,
        liveUsersResult,
        dailyUsersResult,
        usageReportResult,
        ticketUpdatesResult,
      ] =
        await Promise.allSettled([
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
          withTimeout(
            supabase
              .from("support_tickets")
              .select(
                "id, ticket_number, company_name, user_email, subject, module_name, priority, status, created_at, updated_at, assigned_email, resolution_summary"
              )
              .order("created_at", { ascending: false })
              .limit(20),
            "consultar support_tickets"
          ),
          withTimeout(
            supabase
              .from("company_subscriptions")
              .select(
                "company_id, plan_code, plan_name, price_mxn, payment_method, status, trial_ends_at, starts_at, expires_at, grace_until, notes, updated_at"
              )
              .order("updated_at", { ascending: false })
              .limit(100),
            "consultar company_subscriptions"
          ),
          withTimeout(
            supabase
              .from("live_user_presence")
              .select("user_id, user_email, company_id, company_name, current_path, started_at, last_seen_at, is_online")
              .eq("is_online", true)
              .order("last_seen_at", { ascending: false })
              .limit(20),
            "consultar live_user_presence"
          ),
          withTimeout(
            supabase
              .from("user_daily_presence")
              .select("user_id, user_email, company_id, company_name, activity_date, minutes_online, last_seen_at")
              .eq("activity_date", today)
              .order("minutes_online", { ascending: false })
              .limit(20),
            "consultar user_daily_presence"
          ),
          withTimeout(
            supabase
              .from("admin_company_usage_report")
              .select(
                "company_id, empresa, status, usuarios, clientes, productos, cotizaciones, ventas, tickets, total_size_aprox, total_bytes_aprox, last_activity_at"
              )
              .order("total_bytes_aprox", { ascending: false })
              .limit(20),
            "consultar admin_company_usage_report"
          ),
          withTimeout(
            supabase
              .from("support_ticket_updates")
              .select(
                "id, ticket_id, author_email, author_role, previous_status, new_status, message, is_internal, created_at"
              )
              .order("created_at", { ascending: false })
              .limit(100),
            "consultar support_ticket_updates"
          ),
        ]);

      const failureMessage = [
        companiesResult,
        adminsResult,
        logsResult,
        ticketsResult,
        subscriptionsResult,
        liveUsersResult,
        dailyUsersResult,
        usageReportResult,
        ticketUpdatesResult,
      ]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message)
        .find(Boolean);

      const companiesResponse = companiesResult.status === "fulfilled" ? companiesResult.value : null;
      const adminsResponse = adminsResult.status === "fulfilled" ? adminsResult.value : null;
      const logsResponse = logsResult.status === "fulfilled" ? logsResult.value : null;
      const ticketsResponse = ticketsResult.status === "fulfilled" ? ticketsResult.value : null;
      const subscriptionsResponse = subscriptionsResult.status === "fulfilled" ? subscriptionsResult.value : null;
      const liveUsersResponse = liveUsersResult.status === "fulfilled" ? liveUsersResult.value : null;
      const dailyUsersResponse = dailyUsersResult.status === "fulfilled" ? dailyUsersResult.value : null;
      const usageReportResponse = usageReportResult.status === "fulfilled" ? usageReportResult.value : null;
      const ticketUpdatesResponse = ticketUpdatesResult.status === "fulfilled" ? ticketUpdatesResult.value : null;

      if (companiesResponse?.error) throw companiesResponse.error;
      if (adminsResponse?.error) throw adminsResponse.error;
      if (logsResponse?.error) throw logsResponse.error;
      if (ticketsResponse?.error) throw ticketsResponse.error;
      if (subscriptionsResponse?.error) throw subscriptionsResponse.error;
      if (liveUsersResponse?.error) throw liveUsersResponse.error;
      if (dailyUsersResponse?.error) throw dailyUsersResponse.error;
      if (usageReportResponse?.error) throw usageReportResponse.error;
      if (ticketUpdatesResponse?.error) throw ticketUpdatesResponse.error;

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
      setTickets(ticketsResponse?.data || []);
      setSubscriptions((subscriptionsResponse?.data || []).map((entry) => normalizeSubscriptionEntry(entry, companiesResponse?.data || [])));
      setLiveUsers((liveUsersResponse?.data || []).filter((entry) => isPresenceFresh(entry.last_seen_at)));
      setDailyUsers(dailyUsersResponse?.data || []);
      setUsageReport(usageReportResponse?.data || []);
      setTicketUpdates(ticketUpdatesResponse?.data || []);
      setTicketForms((currentValue) => {
        const nextValue = { ...currentValue };

        (ticketsResponse?.data || []).forEach((ticket) => {
          if (!nextValue[ticket.id]) {
            nextValue[ticket.id] = {
              status: ticket.status || "abierto",
              message: "",
              isInternal: false,
            };
          } else {
            nextValue[ticket.id] = {
              ...nextValue[ticket.id],
              status: nextValue[ticket.id].status || ticket.status || "abierto",
            };
          }
        });

        return nextValue;
      });
      setSubscriptionForms((currentValue) => {
        const nextValue = { ...currentValue };
        (subscriptionsResponse?.data || []).forEach((entry) => {
          const normalized = normalizeSubscriptionEntry(entry, companiesResponse?.data || []);
          nextValue[normalized.company_id] = {
            plan_code: currentValue[normalized.company_id]?.plan_code || normalized.plan_code || "trial",
            status: currentValue[normalized.company_id]?.status || normalized.status || "active",
            payment_method:
              currentValue[normalized.company_id]?.payment_method || normalized.payment_method || "transferencia",
            expires_at:
              currentValue[normalized.company_id]?.expires_at ||
              toDateInputValue(normalized.expires_at || normalized.trial_ends_at),
            notes: currentValue[normalized.company_id]?.notes ?? normalized.notes ?? "",
          };
        });
        return nextValue;
      });
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

  function handleCompanyFormChange(event) {
    const { name, value, type, checked } = event.target;
    setCompanyForm((currentValue) => ({
      ...currentValue,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleCreateCompany(event) {
    event.preventDefault();

    const companyName = companyForm.companyName.trim();
    const ownerEmail = companyForm.ownerEmail.trim().toLowerCase();

    if (!companyName || !ownerEmail) {
      setErrorMessage("Captura el nombre de la empresa y el correo del usuario que la administrara.");
      return;
    }

    try {
      setCreatingCompany(true);
      setErrorMessage("");

      const { data, error } = await supabase.rpc("admin_create_company_with_owner", {
        p_company_name: companyName,
        p_owner_email: ownerEmail,
        p_business_type: companyForm.businessType || "general",
        p_make_default: !!companyForm.makeDefault,
      });

      if (error) throw error;

      setCompanyForm({
        companyName: "",
        ownerEmail: "",
        businessType: "general",
        makeDefault: false,
      });

      const resultCompanyName = data?.[0]?.company_name || companyName;
      setStatusMessage(`Empresa creada correctamente: ${resultCompanyName}.`);
      await loadAdminData();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo crear la empresa o asignar el usuario.");
    } finally {
      setCreatingCompany(false);
    }
  }

  function updateSubscriptionForm(companyId, field, value) {
    setSubscriptionForms((currentValue) => {
      const currentEntry =
        currentValue[companyId] ||
        subscriptionRows.find((entry) => entry.company_id === companyId) || {
          plan_code: "trial",
          status: "active",
          payment_method: "transferencia",
          expires_at: "",
          notes: "",
        };

      const nextValue = {
        ...currentValue,
        [companyId]: {
          ...currentEntry,
          [field]: value,
        },
      };

      if (field === "plan_code") {
        nextValue[companyId].expires_at = suggestExpiryDate(value);
      }

      return nextValue;
    });
  }

  async function handleSubscriptionSave(entry) {
    const companyId = entry.company_id;
    const subscriptionForm = subscriptionForms[companyId] || {};
    const planCode = subscriptionForm.plan_code || entry.plan_code || "trial";
    const nextStatus = subscriptionForm.status || entry.status || "active";
    const paymentMethod = subscriptionForm.payment_method || entry.payment_method || "transferencia";
    const expiresAt = subscriptionForm.expires_at
      ? `${subscriptionForm.expires_at}T23:59:59`
      : entry.expires_at || entry.trial_ends_at || null;

    try {
      setSavingSubscriptionId(companyId);
      setErrorMessage("");

      const payload = {
        company_id: companyId,
        plan_code: planCode,
        plan_name: planLabel(planCode),
        price_mxn: PLAN_PRICES[planCode] ?? 0,
        payment_method: paymentMethod,
        status: nextStatus,
        starts_at: entry.starts_at || new Date().toISOString(),
        expires_at: expiresAt,
        trial_ends_at: planCode === "trial" ? expiresAt : null,
        notes: subscriptionForm.notes?.trim() || null,
      };

      const { data, error } = await supabase
        .from("company_subscriptions")
        .upsert(payload, { onConflict: "company_id" })
        .select(
          "company_id, plan_code, plan_name, price_mxn, payment_method, status, trial_ends_at, starts_at, expires_at, grace_until, notes, updated_at"
        )
        .single();

      if (error) throw error;

      const normalized = normalizeSubscriptionEntry(data, companies);
      setSubscriptions((currentValue) => {
        const exists = currentValue.some((item) => item.company_id === companyId);
        return exists
          ? currentValue.map((item) => (item.company_id === companyId ? normalized : item))
          : [normalized, ...currentValue];
      });
      setSubscriptionForms((currentValue) => ({
        ...currentValue,
        [companyId]: {
          plan_code: normalized.plan_code,
          status: normalized.status,
          payment_method: normalized.payment_method || "transferencia",
          expires_at: toDateInputValue(normalized.expires_at || normalized.trial_ends_at),
          notes: normalized.notes || "",
        },
      }));
      setStatusMessage(`Plan actualizado para ${normalized.company_name || "la empresa"}.`);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo actualizar el plan de la empresa.");
    } finally {
      setSavingSubscriptionId("");
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
        <div className="stat-card success">
          <div className="label">En prueba</div>
          <div className="value">{metrics.trialCompanies}</div>
        </div>
        <div className="stat-card">
          <div className="label">Mensuales</div>
          <div className="value">{metrics.monthlyCompanies}</div>
        </div>
        <div className="stat-card warning">
          <div className="label">Anuales</div>
          <div className="value">{metrics.yearlyCompanies}</div>
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
        <div className="stat-card danger">
          <div className="label">Planes vencidos</div>
          <div className="value">{metrics.expiredPlans}</div>
        </div>
        <button
          type="button"
          className="stat-card stat-card-button warning"
          onClick={() => navigate("/mesa-tickets")}
        >
          <div className="label">Tickets abiertos</div>
          <div className="value">{metrics.openTickets}</div>
        </button>
        <button
          type="button"
          className="stat-card stat-card-button danger"
          onClick={() => navigate("/mesa-tickets")}
        >
          <div className="label">Tickets urgentes</div>
          <div className="value">{metrics.criticalTickets}</div>
        </button>
        <div className="stat-card success">
          <div className="label">Usuarios en linea</div>
          <div className="value">{metrics.onlineUsers}</div>
        </div>
        <div className="stat-card">
          <div className="label">Empresas conectadas</div>
          <div className="value">{metrics.onlineCompanies}</div>
        </div>
        <div className="stat-card warning">
          <div className="label">Horas online hoy</div>
          <div className="value">{metrics.todayHours}</div>
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

          <div className="section-head admin-usage-head">
            <div>
              <h2 className="section-title">Alta rapida de empresa</h2>
              <p className="section-copy">
                Crea una empresa nueva y asignala a un usuario existente por correo, sin salir del panel.
              </p>
            </div>
          </div>

          <form className="form-grid" onSubmit={handleCreateCompany}>
            <div className="form-group">
              <label>Nombre de la empresa</label>
              <input
                name="companyName"
                value={companyForm.companyName}
                onChange={handleCompanyFormChange}
                placeholder="SEPROBAT COMPANY"
              />
            </div>

            <div className="form-group">
              <label>Correo del usuario</label>
              <input
                name="ownerEmail"
                type="email"
                value={companyForm.ownerEmail}
                onChange={handleCompanyFormChange}
                placeholder="compras@seprobat.com"
              />
            </div>

            <div className="form-group">
              <label>Tipo de negocio</label>
              <select name="businessType" value={companyForm.businessType} onChange={handleCompanyFormChange}>
                <option value="general">general</option>
                <option value="retail">retail</option>
                <option value="arquitectura">arquitectura</option>
                <option value="servicios">servicios</option>
              </select>
            </div>

            <label className="admin-checkbox-field">
              <input
                name="makeDefault"
                type="checkbox"
                checked={companyForm.makeDefault}
                onChange={handleCompanyFormChange}
              />
              <span>Dejarla como empresa predeterminada para ese usuario</span>
            </label>

            <div className="settings-actions">
              <button type="submit" className="primary-btn" disabled={creatingCompany}>
                {creatingCompany ? "Creando empresa..." : "Crear empresa y asignar usuario"}
              </button>
            </div>
          </form>

          <div className="section-head admin-usage-head">
            <div>
              <h2 className="section-title">Planes y vencimientos</h2>
              <p className="section-copy">
                Administra la prueba gratis de 14 dias y cambia cada empresa a plan mensual de 399 MXN o anual de
                3,600 MXN.
              </p>
            </div>
          </div>

          {subscriptionRows.length > 0 ? (
            <div className="admin-plans-grid">
              {subscriptionRows.map((entry) => {
                const form = subscriptionForms[entry.company_id] || {};
                const effectivePlan = form.plan_code || entry.plan_code || "trial";
                const effectiveStatus = form.status || entry.status || "active";
                const effectiveExpiry =
                  form.expires_at || toDateInputValue(entry.expires_at || entry.trial_ends_at);

                return (
                  <article key={entry.company_id} className="admin-plan-card">
                    <div className="admin-plan-card-head">
                      <div>
                        <h3>{entry.company_name || "Sin empresa"}</h3>
                        <p>{entry.owner_email || "Sin correo asociado"}</p>
                      </div>
                      <div className="support-card-badges">
                        <span className={`status-chip ${planChipClass(effectivePlan)}`}>{planLabel(effectivePlan)}</span>
                        <span className={`status-chip ${companyStatusClass(effectiveStatus)}`}>
                          {companyStatusLabel(effectiveStatus)}
                        </span>
                      </div>
                    </div>

                    <div className="admin-plan-meta">
                      <div>
                        <span className="quotes-summary-label">Precio</span>
                        <strong>{formatCurrency(PLAN_PRICES[effectivePlan] ?? entry.price_mxn ?? 0)}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Vence</span>
                        <strong>{effectiveExpiry ? formatDate(effectiveExpiry) : "Sin fecha"}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Pago</span>
                        <strong>{paymentMethodLabel(form.payment_method || entry.payment_method)}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Ultima actualizacion</span>
                        <strong>{entry.updated_at ? formatDate(entry.updated_at) : "Sin fecha"}</strong>
                      </div>
                    </div>

                    <div className="admin-plan-form-grid">
                      <div className="form-group">
                        <label>Plan</label>
                        <select
                          className="quotes-select"
                          value={effectivePlan}
                          onChange={(event) => updateSubscriptionForm(entry.company_id, "plan_code", event.target.value)}
                        >
                          <option value="trial">Prueba gratis</option>
                          <option value="monthly">Mensual 399 MXN</option>
                          <option value="yearly">Anual 3,600 MXN</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Estatus</label>
                        <select
                          className="quotes-select"
                          value={effectiveStatus}
                          onChange={(event) => updateSubscriptionForm(entry.company_id, "status", event.target.value)}
                        >
                          <option value="active">Activa</option>
                          <option value="expired">Vencida</option>
                          <option value="suspended">Suspendida</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Forma de pago</label>
                        <select
                          className="quotes-select"
                          value={form.payment_method || entry.payment_method || "transferencia"}
                          onChange={(event) =>
                            updateSubscriptionForm(entry.company_id, "payment_method", event.target.value)
                          }
                        >
                          <option value="transferencia">Transferencia</option>
                          <option value="mercado_pago">Mercado Pago</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Vencimiento</label>
                        <input
                          type="date"
                          value={effectiveExpiry || ""}
                          onChange={(event) => updateSubscriptionForm(entry.company_id, "expires_at", event.target.value)}
                        />
                      </div>

                      <div className="form-group form-group-full">
                        <label>Notas</label>
                        <textarea
                          rows="2"
                          value={form.notes ?? entry.notes ?? ""}
                          onChange={(event) => updateSubscriptionForm(entry.company_id, "notes", event.target.value)}
                          placeholder="Pago recibido, fecha de renovacion, observaciones..."
                        />
                      </div>
                    </div>

                    <div className="settings-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => handleSubscriptionSave(entry)}
                        disabled={savingSubscriptionId === entry.company_id}
                      >
                        {savingSubscriptionId === entry.company_id ? "Guardando plan..." : "Guardar plan"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <strong>No hay planes cargados todavia.</strong>
              <span>En cuanto ejecutes el SQL de company_subscriptions veras aqui los planes por empresa.</span>
            </div>
          )}

          <div className="section-head admin-usage-head">
            <div>
              <h2 className="section-title">Consumo por empresa</h2>
              <p className="section-copy">
                Resumen de uso por cliente: usuarios, registros, tickets, tamano estimado y ultima actividad.
              </p>
            </div>
          </div>

          {usageReport.length > 0 ? (
            <div className="table-wrap">
              <table className="table reports-table">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Estatus</th>
                    <th>Usuarios</th>
                    <th>Clientes</th>
                    <th>Productos</th>
                    <th>Cotizaciones</th>
                    <th>Ventas</th>
                    <th>Tickets</th>
                    <th>Tamano</th>
                    <th>Ultima actividad</th>
                  </tr>
                </thead>
                <tbody>
                  {usageReport.map((entry) => (
                    <tr key={entry.company_id}>
                      <td>{entry.empresa || "Sin empresa"}</td>
                      <td>
                        <span className={`status-chip ${companyStatusClass(entry.status)}`}>
                          {companyStatusLabel(entry.status)}
                        </span>
                      </td>
                      <td>{entry.usuarios || 0}</td>
                      <td>{entry.clientes || 0}</td>
                      <td>{entry.productos || 0}</td>
                      <td>{entry.cotizaciones || 0}</td>
                      <td>{entry.ventas || 0}</td>
                      <td>{entry.tickets || 0}</td>
                      <td>{entry.total_size_aprox || "0 bytes"}</td>
                      <td>{entry.last_activity_at ? formatDate(entry.last_activity_at) : "Sin actividad"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <strong>No hay reporte de consumo disponible.</strong>
              <span>Ejecuta la vista `admin_company_usage_report` en Supabase para mostrarlo aqui.</span>
            </div>
          )}
        </section>

        <aside className="dashboard-side-stack">
          <section className="module-card">
            <div className="section-head dashboard-side-head">
              <div>
                <h2 className="section-title">Conectados ahora</h2>
                <p className="section-copy">Usuarios y empresas con actividad viva en este momento.</p>
              </div>
            </div>

            {liveUsers.length > 0 ? (
              <div className="dashboard-list">
                {liveUsers.map((entry) => (
                  <article key={`${entry.user_id}-${entry.company_id}`} className="dashboard-list-item">
                    <div>
                      <strong>{entry.user_email || "Usuario"}</strong>
                      <p>{entry.company_name || "Sin empresa"}</p>
                      <p>{entry.current_path || "/"}</p>
                    </div>
                    <div className="dashboard-list-meta">
                      <span className="status-chip status-chip-success">En linea</span>
                      <span>{formatElapsed(entry.started_at)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No hay usuarios activos ahora.</strong>
                <span>En cuanto alguien use el sistema aparecerá aquí en tiempo real.</span>
              </div>
            )}
          </section>

          <section className="module-card">
            <div className="section-head dashboard-side-head">
              <div>
                <h2 className="section-title">Tiempo online hoy</h2>
                <p className="section-copy">Acumulado diario aproximado por usuario y empresa.</p>
              </div>
            </div>

            {dailyUsers.length > 0 ? (
              <div className="dashboard-list">
                {dailyUsers.map((entry) => (
                  <article key={`${entry.user_id}-${entry.company_id}-${entry.activity_date}`} className="dashboard-list-item">
                    <div>
                      <strong>{entry.user_email || "Usuario"}</strong>
                      <p>{entry.company_name || "Sin empresa"}</p>
                    </div>
                    <div className="dashboard-list-meta">
                      <span>{formatMinutes(entry.minutes_online)}</span>
                      <span>{formatDate(entry.last_seen_at)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No hay tiempo acumulado hoy.</strong>
                <span>Cuando los usuarios naveguen el sistema verás aquí su uso diario.</span>
              </div>
            )}
          </section>

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

          <section className="module-card">
            <div className="section-head dashboard-side-head">
              <div>
                <h2 className="section-title">Tickets recientes</h2>
                <p className="section-copy">Seguimiento de incidencias levantadas por usuarios.</p>
              </div>
            </div>

            {tickets.length > 0 ? (
              <div className="support-cards-grid admin-support-grid">
                {tickets.map((ticket) => (
                  <article key={ticket.id} className="support-card admin-ticket-card">
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
                      </div>
                    </div>

                    <div className="quote-card-meta">
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

                    {ticket.resolution_summary ? (
                      <p className="quote-card-notes">Resolucion: {ticket.resolution_summary}</p>
                    ) : null}

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
                        Nota interna (no visible para el usuario)
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

                    <div className="admin-ticket-timeline">
                      <span className="quotes-summary-label">Seguimiento</span>
                      {(updatesByTicket[ticket.id] || []).length > 0 ? (
                        <div className="admin-ticket-updates">
                          {(updatesByTicket[ticket.id] || []).slice(0, 4).map((entry) => (
                            <article key={entry.id} className="admin-ticket-update">
                              <div className="admin-ticket-update-head">
                                <strong>{entry.author_email || entry.author_role || "Sistema"}</strong>
                                <span>{formatDate(entry.created_at)}</span>
                              </div>
                              <p>{entry.message}</p>
                              <div className="admin-ticket-update-meta">
                                {entry.previous_status || entry.new_status ? (
                                  <span>
                                    {supportStatusLabel(entry.previous_status || "abierto")} →{" "}
                                    {supportStatusLabel(entry.new_status || "abierto")}
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
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No hay tickets recientes.</strong>
                <span>Los tickets levantados por los usuarios apareceran aqui.</span>
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

function getTodayStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isPresenceFresh(value) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() <= 2 * 60 * 1000;
}

function formatElapsed(value) {
  if (!value) return "Sin sesion";
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
}

function formatMinutes(value) {
  const minutes = Number(value || 0);
  if (!minutes) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
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

function normalizeSubscriptionEntry(entry, companies) {
  const company = (companies || []).find((item) => item.company_id === entry.company_id);
  return {
    ...entry,
    company_name: company?.company_name || "Sin empresa",
    owner_email: company?.owner_email || "Sin correo",
  };
}

function toDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function suggestExpiryDate(planCode) {
  const date = new Date();
  if (planCode === "yearly") {
    date.setDate(date.getDate() + 365);
  } else if (planCode === "monthly") {
    date.setDate(date.getDate() + 30);
  } else {
    date.setDate(date.getDate() + 14);
  }

  return toDateInputValue(date.toISOString());
}

function planLabel(planCode) {
  if (planCode === "monthly") return "Mensual";
  if (planCode === "yearly") return "Anual";
  return "Prueba";
}

function planChipClass(planCode) {
  if (planCode === "yearly") return "status-chip-success";
  if (planCode === "monthly") return "status-chip-warning";
  return "status-chip";
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function isSubscriptionExpired(entry) {
  const normalizedStatus = String(entry?.status || "active").toLowerCase();
  if (normalizedStatus === "expired") return true;
  const expiresAt = entry?.expires_at || entry?.trial_ends_at;
  if (!expiresAt) return false;
  const expiresTime = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresTime)) return false;
  return Date.now() > expiresTime;
}

function paymentMethodLabel(value) {
  if (value === "mercado_pago") return "Mercado Pago";
  if (value === "transferencia") return "Transferencia";
  return "Sin definir";
}
