import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

const REQUEST_TIMEOUT_MS = 10000;

export default function DashboardPage({ currentUser, companyId, company, branding, subscription }) {
  const companyName = branding?.business_name || company?.name || "Tu empresa";
  const accentColor = branding?.primary_color || company?.primary_color || "#1d4ed8";
  const logoUrl = branding?.logo_url || company?.logo_url || "";

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusDetail, setStatusDetail] = useState("Preparando indicadores...");
  const [clientes, setClientes] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [inventoryMovements, setInventoryMovements] = useState([]);
  const [supportTickets, setSupportTickets] = useState([]);

  useEffect(() => {
    loadDashboard();
  }, [companyId]);

  const inventoryByProduct = useMemo(() => {
    return inventoryMovements.reduce((accumulator, movement) => {
      const currentValue = accumulator[movement.producto_id] || 0;
      const delta = movement.tipo_movimiento === "salida" ? -movement.cantidad : movement.cantidad;
      accumulator[movement.producto_id] = currentValue + delta;
      return accumulator;
    }, {});
  }, [inventoryMovements]);

  const outOfStockProducts = useMemo(() => {
    return productos.filter((producto) => Number(inventoryByProduct[producto.id] || 0) <= 0);
  }, [productos, inventoryByProduct]);

  const metrics = useMemo(() => {
    const today = new Date();
    const todayKey = today.toDateString();
    const month = today.getMonth();
    const year = today.getFullYear();

    const pendingQuotes = cotizaciones.filter((entry) => entry.estado === "pendiente");
    const approvedQuotes = cotizaciones.filter((entry) => entry.estado === "autorizada");
    const rejectedQuotes = cotizaciones.filter((entry) => entry.estado === "rechazada");

    const salesToday = ventas.filter((venta) => new Date(venta.created_at).toDateString() === todayKey);
    const salesMonth = ventas.filter((venta) => {
      const ventaDate = new Date(venta.created_at);
      return ventaDate.getMonth() === month && ventaDate.getFullYear() === year;
    });

    return {
      clients: clientes.length,
      products: productos.length,
      pendingQuotes: pendingQuotes.length,
      approvedQuotes: approvedQuotes.length,
      rejectedQuotes: rejectedQuotes.length,
      pendingAmount: pendingQuotes.reduce((sum, item) => sum + Number(item.total || 0), 0),
      salesTodayAmount: salesToday.reduce((sum, item) => sum + Number(item.total || 0), 0),
      salesMonthAmount: salesMonth.reduce((sum, item) => sum + Number(item.total || 0), 0),
      salesCount: ventas.length,
      outOfStock: outOfStockProducts.length,
      openSupportTickets: supportTickets.filter((entry) => entry.status === "abierto" || entry.status === "en_revision").length,
    };
  }, [clientes, productos, cotizaciones, ventas, outOfStockProducts, supportTickets]);

  const subscriptionSummary = useMemo(() => {
    if (!subscription) {
      return {
        planLabel: "Sin plan configurado",
        statusLabel: "Pendiente",
        expiryLabel: "Configuralo en Super Admin",
        paymentLabel: "Sin forma de pago",
        remainingLabel: "Sin fecha",
        isNearExpiry: false,
      };
    }

    const expiresAt = subscription.expires_at || subscription.trial_ends_at;
    const remainingDays = calculateRemainingDays(expiresAt);

    return {
      planLabel: planLabel(subscription.plan_code),
      statusLabel: subscriptionStatusLabel(subscription.status),
      expiryLabel: expiresAt ? formatDate(expiresAt) : "Sin fecha",
      paymentLabel: paymentMethodLabel(subscription.payment_method),
      remainingLabel: remainingDays == null ? "Sin vencimiento" : `${remainingDays} dia(s) restantes`,
      isNearExpiry: remainingDays != null && remainingDays <= 5,
    };
  }, [subscription]);

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

  async function loadDashboard() {
    if (!companyId) return;

    try {
      setLoading(true);
      setErrorMessage("");
      setStatusDetail("Consultando actividad comercial...");

      const [clientesResult, productosResult, cotizacionesResult, ventasResult, inventoryResult, supportResult] = await Promise.allSettled([
        withTimeout(
          supabase
            .from("clientes")
            .select("id, nombre, empresa, created_at")
            .eq("tenant_id", companyId)
            .order("created_at", { ascending: false })
            .limit(6),
          "consultar clientes"
        ),
        withTimeout(
          supabase
            .from("productos")
            .select("id, nombre, sku, categoria, precio, created_at")
            .eq("tenant_id", companyId)
            .order("created_at", { ascending: false }),
          "consultar productos"
        ),
        withTimeout(
          supabase
            .from("cotizaciones")
            .select("id, folio, cliente_nombre, estado, total, created_at")
            .eq("tenant_id", companyId)
            .order("created_at", { ascending: false })
            .limit(20),
          "consultar cotizaciones"
        ),
        withTimeout(
          supabase
            .from("ventas")
            .select("id, folio, cliente_nombre, payment_method, total, created_at")
            .eq("tenant_id", companyId)
            .order("created_at", { ascending: false })
            .limit(20),
          "consultar ventas"
        ),
        withTimeout(
          supabase
            .from("inventory_movements")
            .select("id, company_id, product_id, movement_type, quantity")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false }),
          "consultar inventario"
        ),
        withTimeout(
          supabase
            .from("support_tickets")
            .select("id, ticket_number, subject, module_name, priority, status, created_at")
            .eq("tenant_id", companyId)
            .eq("user_id", currentUser?.id || "")
            .order("created_at", { ascending: false })
            .limit(10),
          "consultar tickets de soporte"
        ),
      ]);

      const failures = [clientesResult, productosResult, cotizacionesResult, ventasResult, inventoryResult, supportResult]
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message)
        .filter(Boolean);

      if (failures.length) {
        throw new Error(failures[0]);
      }

      const clientesResponse = clientesResult.value;
      const productosResponse = productosResult.value;
      const cotizacionesResponse = cotizacionesResult.value;
      const ventasResponse = ventasResult.value;
      const inventoryResponse = inventoryResult.value;
      const supportResponse = supportResult.value;

      if (clientesResponse.error) throw clientesResponse.error;
      if (productosResponse.error) throw productosResponse.error;
      if (cotizacionesResponse.error) throw cotizacionesResponse.error;
      if (ventasResponse.error) throw ventasResponse.error;
      if (inventoryResponse.error) throw inventoryResponse.error;
      if (supportResponse.error) throw supportResponse.error;

      setClientes(clientesResponse.data || []);
      setProductos(productosResponse.data || []);
      setCotizaciones(cotizacionesResponse.data || []);
      setVentas(ventasResponse.data || []);
      setInventoryMovements((inventoryResponse.data || []).map(normalizeMovement));
      setSupportTickets(supportResponse.data || []);
      setStatusDetail("Indicadores actualizados.");
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo cargar el dashboard.");
      setStatusDetail("No se pudieron actualizar los indicadores.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Resumen general de costos, presupuestos y seguimiento comercial.</p>
      </div>

      <div className="dashboard-hero" style={{ "--hero-accent": accentColor }}>
        <div className="dashboard-hero-brand">
          <div className="dashboard-hero-logo">
            {logoUrl ? (
              <img src={logoUrl} alt={companyName} className="dashboard-hero-logo-image" />
            ) : (
              <span>{companyName.slice(0, 2).toUpperCase()}</span>
            )}
          </div>

          <div>
            <h2>{companyName}</h2>
            <p>{currentUser?.email || "Usuario activo"}</p>
            <p>{statusDetail}</p>
          </div>
        </div>

        <div className="dashboard-hero-chip">
          <span>Ventas hoy</span>
          <strong>{formatCurrency(metrics.salesTodayAmount)}</strong>
        </div>
      </div>

      <section className={`module-card dashboard-plan-card ${subscriptionSummary.isNearExpiry ? "dashboard-plan-card-warning" : ""}`}>
        <div className="section-head dashboard-side-head">
          <div>
            <h2 className="section-title">Plan y renovacion</h2>
            <p className="section-copy">Consulta tu tiempo restante y la forma de pago registrada para renovar.</p>
          </div>
        </div>

        <div className="dashboard-plan-grid">
          <div>
            <span className="quotes-summary-label">Plan actual</span>
            <strong>{subscriptionSummary.planLabel}</strong>
          </div>
          <div>
            <span className="quotes-summary-label">Estado</span>
            <strong>{subscriptionSummary.statusLabel}</strong>
          </div>
          <div>
            <span className="quotes-summary-label">Vence</span>
            <strong>{subscriptionSummary.expiryLabel}</strong>
          </div>
          <div>
            <span className="quotes-summary-label">Tiempo restante</span>
            <strong>{subscriptionSummary.remainingLabel}</strong>
          </div>
          <div>
            <span className="quotes-summary-label">Forma de pago</span>
            <strong>{subscriptionSummary.paymentLabel}</strong>
          </div>
          <div>
            <span className="quotes-summary-label">Renovacion</span>
            <strong>Solicitala por transferencia o Mercado Pago</strong>
          </div>
        </div>
      </section>

      {errorMessage ? <p className="form-message form-message-error">{errorMessage}</p> : null}

      <div className="dashboard-metrics-grid">
        <div className="stat-card success">
          <div className="label">Ventas del mes</div>
          <div className="value">{formatCurrency(metrics.salesMonthAmount)}</div>
        </div>
        <div className="stat-card warning">
          <div className="label">Cotizaciones pendientes</div>
          <div className="value">{metrics.pendingQuotes}</div>
        </div>
        <div className="stat-card">
          <div className="label">Clientes registrados</div>
          <div className="value">{metrics.clients}</div>
        </div>
        <div className="stat-card danger">
          <div className="label">Articulos sin stock</div>
          <div className="value">{metrics.outOfStock}</div>
        </div>
        <div className="stat-card warning">
          <div className="label">Mis tickets abiertos</div>
          <div className="value">{metrics.openSupportTickets}</div>
        </div>
      </div>

      <div className="dashboard-shell">
        <section className="module-card dashboard-activity-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Actividad reciente</h2>
              <p className="section-copy">Ultimos movimientos comerciales de tu empresa.</p>
            </div>
            <button type="button" className="secondary-btn" onClick={loadDashboard} disabled={loading}>
              {loading ? "Actualizando..." : "Recargar"}
            </button>
          </div>

          <div className="dashboard-activity-grid">
            <div className="dashboard-list-card">
              <div className="dashboard-list-head">
                <h3>Ultimas ventas</h3>
                <Link to="/punto-venta" className="dashboard-link-btn">Ir a POS</Link>
              </div>
              {ventas.length > 0 ? (
                <div className="dashboard-list">
                  {ventas.slice(0, 5).map((venta) => (
                    <article key={venta.id} className="dashboard-list-item">
                      <div>
                        <strong>{venta.folio}</strong>
                        <p>{venta.cliente_nombre || "Venta mostrador"}</p>
                      </div>
                      <div className="dashboard-list-meta">
                        <strong>{formatCurrency(venta.total)}</strong>
                        <span>{formatDate(venta.created_at)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <strong>No hay ventas recientes.</strong>
                  <span>Registra la primera desde el mini POS.</span>
                </div>
              )}
            </div>

            <div className="dashboard-list-card">
              <div className="dashboard-list-head">
                <h3>Ultimas cotizaciones</h3>
                <Link to="/cotizaciones" className="dashboard-link-btn">Ir a cotizaciones</Link>
              </div>
              {cotizaciones.length > 0 ? (
                <div className="dashboard-list">
                  {cotizaciones.slice(0, 5).map((cotizacion) => (
                    <article key={cotizacion.id} className="dashboard-list-item">
                      <div>
                        <strong>{cotizacion.folio}</strong>
                        <p>{cotizacion.cliente_nombre || "Sin cliente"}</p>
                      </div>
                      <div className="dashboard-list-meta">
                        <span className={`status-chip ${statusClassName(cotizacion.estado)}`}>
                          {statusLabel(cotizacion.estado)}
                        </span>
                        <span>{formatCurrency(cotizacion.total)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <strong>No hay cotizaciones recientes.</strong>
                  <span>Crea la primera desde el modulo comercial.</span>
                </div>
              )}
            </div>

            <div className="dashboard-list-card">
              <div className="dashboard-list-head">
                <h3>Mis tickets de soporte</h3>
                <Link to="/soporte" className="dashboard-link-btn">Ir a soporte</Link>
              </div>
              {supportTickets.length > 0 ? (
                <div className="dashboard-list">
                  {supportTickets.slice(0, 5).map((ticket) => (
                    <article key={ticket.id} className="dashboard-list-item">
                      <div>
                        <strong>{ticket.ticket_number || "Sin folio"}</strong>
                        <p>{ticket.subject || "Ticket sin asunto"}</p>
                      </div>
                      <div className="dashboard-list-meta">
                        <span className={`status-chip ${supportStatusClass(ticket.status)}`}>
                          {supportStatusLabel(ticket.status)}
                        </span>
                        <span>{supportPriorityLabel(ticket.priority)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <strong>No has levantado tickets.</strong>
                  <span>Cuando reportes uno, lo veras aqui con su estatus.</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="dashboard-side-stack">
          <section className="module-card dashboard-kpi-card">
            <div className="section-head dashboard-side-head">
              <div>
                <h2 className="section-title">Embudo comercial</h2>
                <p className="section-copy">Estado de tus cotizaciones actuales.</p>
              </div>
            </div>

            <div className="dashboard-kpi-list">
              <div className="dashboard-kpi-row">
                <span>Pendientes</span>
                <strong>{metrics.pendingQuotes}</strong>
              </div>
              <div className="dashboard-kpi-row">
                <span>Autorizadas</span>
                <strong>{metrics.approvedQuotes}</strong>
              </div>
              <div className="dashboard-kpi-row">
                <span>Rechazadas</span>
                <strong>{metrics.rejectedQuotes}</strong>
              </div>
              <div className="dashboard-kpi-row dashboard-kpi-row-amount">
                <span>Potencial pendiente</span>
                <strong>{formatCurrency(metrics.pendingAmount)}</strong>
              </div>
            </div>
          </section>

          <section className="module-card dashboard-stock-alert-card">
            <div className="section-head dashboard-side-head">
              <div>
                <h2 className="section-title">Stock en cero</h2>
                <p className="section-copy">Articulos que necesitan reposicion inmediata.</p>
              </div>
              <Link to="/inventario" className="dashboard-link-btn">Ir a inventario</Link>
            </div>

            {outOfStockProducts.length > 0 ? (
              <div className="dashboard-list">
                {outOfStockProducts.slice(0, 6).map((producto) => (
                  <article key={producto.id} className="dashboard-list-item dashboard-stock-alert-item">
                    <div>
                      <strong>{producto.nombre}</strong>
                      <p>{producto.sku || "Sin SKU"}</p>
                    </div>
                    <div className="dashboard-list-meta">
                      <span className="status-chip status-chip-danger">Sin stock</span>
                      <span>{formatQuantity(inventoryByProduct[producto.id] || 0)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No hay articulos agotados.</strong>
                <span>Tu inventario con existencia cero esta bajo control.</span>
              </div>
            )}
          </section>

          <section className="module-card dashboard-shortcuts-card">
            <div className="section-head dashboard-side-head">
              <div>
                <h2 className="section-title">Acciones rapidas</h2>
                <p className="section-copy">Atajos para las tareas mas frecuentes.</p>
              </div>
            </div>

            <div className="dashboard-shortcuts-grid">
              <Link to="/cotizaciones" className="dashboard-shortcut-tile">
                <strong>Nueva cotizacion</strong>
                <span>Prepara propuestas y PDF</span>
              </Link>
              <Link to="/punto-venta" className="dashboard-shortcut-tile">
                <strong>Nueva venta</strong>
                <span>Abre el mini POS</span>
              </Link>
              <Link to="/clientes" className="dashboard-shortcut-tile">
                <strong>Nuevo cliente</strong>
                <span>Agrega y actualiza cartera</span>
              </Link>
              <Link to="/productos" className="dashboard-shortcut-tile">
                <strong>Nuevo producto</strong>
                <span>Actualiza catalogo y precios</span>
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function normalizeMovement(row) {
  return {
    id: row.id,
    producto_id: row.product_id || null,
    tipo_movimiento: row.movement_type || "entrada",
    cantidad: Number(row.quantity || 0),
  };
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

function formatQuantity(value) {
  return new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusClassName(status) {
  if (status === "autorizada") return "status-chip-success";
  if (status === "rechazada") return "status-chip-danger";
  return "status-chip-warning";
}

function statusLabel(status) {
  if (status === "autorizada") return "Autorizada";
  if (status === "rechazada") return "No autorizada";
  return "Pendiente";
}

function supportPriorityLabel(priority) {
  if (priority === "critica") return "Critica";
  if (priority === "alta") return "Alta";
  if (priority === "baja") return "Baja";
  return "Media";
}

function supportStatusLabel(status) {
  if (status === "en_revision") return "En revision";
  if (status === "resuelto") return "Resuelto";
  if (status === "cerrado") return "Cerrado";
  return "Abierto";
}

function supportStatusClass(status) {
  if (status === "resuelto" || status === "cerrado") return "status-chip-success";
  if (status === "en_revision") return "status-chip";
  return "status-chip-warning";
}

function calculateRemainingDays(value) {
  if (!value) return null;
  const expiresAt = new Date(value).getTime();
  if (Number.isNaN(expiresAt)) return null;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)));
}

function planLabel(planCode) {
  if (planCode === "monthly") return "Mensual 399 MXN";
  if (planCode === "yearly") return "Anual 3,600 MXN";
  return "Prueba gratis";
}

function subscriptionStatusLabel(status) {
  if (status === "suspended") return "Suspendido";
  if (status === "expired") return "Vencido";
  return "Activo";
}

function paymentMethodLabel(value) {
  if (value === "mercado_pago") return "Mercado Pago";
  if (value === "transferencia") return "Transferencia";
  return "Sin definir";
}
