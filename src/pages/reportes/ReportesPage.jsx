import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const REQUEST_TIMEOUT_MS = 10000;

const REPORT_OPTIONS = [
  { id: "clientes", label: "Clientes" },
  { id: "productos", label: "Articulos" },
  { id: "ventas", label: "Ventas" },
  { id: "cotizaciones", label: "Cotizaciones" },
];

export default function ReportesPage({ companyId, company, branding }) {
  const [selectedReport, setSelectedReport] = useState("clientes");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [clientes, setClientes] = useState([]);
  const [productos, setProductos] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [inventoryMovements, setInventoryMovements] = useState([]);

  const companyName = branding?.business_name || company?.name || "Tu empresa";

  useEffect(() => {
    loadReports();
  }, [companyId]);

  const inventoryByProduct = useMemo(() => {
    return inventoryMovements.reduce((accumulator, movement) => {
      const currentValue = accumulator[movement.producto_id] || 0;
      const delta = movement.tipo_movimiento === "salida" ? -movement.cantidad : movement.cantidad;
      accumulator[movement.producto_id] = currentValue + delta;
      return accumulator;
    }, {});
  }, [inventoryMovements]);

  const reportConfig = useMemo(() => {
    if (selectedReport === "productos") {
      return {
        title: "Reporte de articulos",
        subtitle: "Catalogo actual con precio, categoria, marca y existencia en inventario.",
        columns: ["SKU", "Nombre", "Categoria", "Marca", "Inventario", "Precio"],
        rows: productos.map((item) => [
          item.sku || "-",
          item.nombre || "-",
          item.categoria || "-",
          item.marca || "-",
          formatQuantity(inventoryByProduct[item.id] || 0),
          formatCurrency(item.precio),
        ]),
        summary: [
          { label: "Articulos registrados", value: String(productos.length) },
          {
            label: "Piezas en inventario",
            value: formatQuantity(
              productos.reduce((sum, item) => sum + Number(inventoryByProduct[item.id] || 0), 0)
            ),
          },
          {
            label: "Valor promedio",
            value: formatCurrency(
              productos.length
                ? productos.reduce((sum, item) => sum + Number(item.precio || 0), 0) / productos.length
                : 0
            ),
          },
        ],
      };
    }

    if (selectedReport === "ventas") {
      return {
        title: "Reporte de ventas",
        subtitle: "Ultimos movimientos de venta y metodo de pago.",
        columns: ["Folio", "Cliente", "Metodo", "Total", "Fecha"],
        rows: ventas.map((item) => [
          item.folio || "-",
          item.cliente_nombre || "Venta mostrador",
          labelForPaymentMethod(item.payment_method),
          formatCurrency(item.total),
          formatDate(item.created_at),
        ]),
        summary: [
          { label: "Ventas registradas", value: String(ventas.length) },
          {
            label: "Monto acumulado",
            value: formatCurrency(ventas.reduce((sum, item) => sum + Number(item.total || 0), 0)),
          },
        ],
      };
    }

    if (selectedReport === "cotizaciones") {
      return {
        title: "Reporte de cotizaciones",
        subtitle: "Seguimiento comercial de propuestas emitidas.",
        columns: ["Folio", "Cliente", "Estatus", "Total", "Fecha"],
        rows: cotizaciones.map((item) => [
          item.folio || "-",
          item.cliente_nombre || "-",
          statusLabel(item.estado),
          formatCurrency(item.total),
          formatDate(item.created_at),
        ]),
        summary: [
          { label: "Pendientes", value: String(cotizaciones.filter((item) => item.estado === "pendiente").length) },
          {
            label: "Monto potencial",
            value: formatCurrency(
              cotizaciones
                .filter((item) => item.estado === "pendiente")
                .reduce((sum, item) => sum + Number(item.total || 0), 0)
            ),
          },
        ],
      };
    }

    return {
      title: "Reporte de clientes",
      subtitle: "Cartera comercial y datos de contacto.",
      columns: ["Nombre", "Empresa", "Telefono", "Correo", "RFC"],
      rows: clientes.map((item) => [
        item.nombre || "-",
        item.empresa || "-",
        item.telefono || "-",
        item.email || "-",
        item.rfc || "-",
      ]),
      summary: [
        { label: "Clientes registrados", value: String(clientes.length) },
        {
          label: "Con empresa capturada",
          value: String(clientes.filter((item) => item.empresa).length),
        },
      ],
    };
  }, [selectedReport, clientes, productos, ventas, cotizaciones, inventoryByProduct]);

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

  async function loadReports() {
    if (!companyId) return;

    try {
      setLoading(true);
      setErrorMessage("");

      const [clientesResult, productosResult, ventasResult, cotizacionesResult, inventoryResult] = await Promise.allSettled([
        withTimeout(
          supabase
            .from("clientes")
            .select("id, nombre, empresa, telefono, email, rfc")
            .eq("tenant_id", companyId)
            .order("nombre", { ascending: true }),
          "consultar clientes"
        ),
        withTimeout(
          supabase
            .from("productos")
            .select("id, sku, nombre, categoria, marca, precio")
            .eq("tenant_id", companyId)
            .order("nombre", { ascending: true }),
          "consultar productos"
        ),
        withTimeout(
          supabase
            .from("ventas")
            .select("id, folio, cliente_nombre, payment_method, total, created_at")
            .eq("tenant_id", companyId)
            .order("created_at", { ascending: false })
            .limit(50),
          "consultar ventas"
        ),
        withTimeout(
          supabase
            .from("cotizaciones")
            .select("id, folio, cliente_nombre, estado, total, created_at")
            .eq("tenant_id", companyId)
            .order("created_at", { ascending: false })
            .limit(50),
          "consultar cotizaciones"
        ),
        withTimeout(
          supabase
            .from("inventory_movements")
            .select("id, company_id, product_id, movement_type, quantity")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false }),
          "consultar inventario"
        ),
      ]);

      const responses = [clientesResult, productosResult, ventasResult, cotizacionesResult, inventoryResult];
      const firstFailure = responses.find((result) => result.status === "rejected");
      if (firstFailure?.reason) throw firstFailure.reason;

      const clientesResponse = clientesResult.value;
      const productosResponse = productosResult.value;
      const ventasResponse = ventasResult.value;
      const cotizacionesResponse = cotizacionesResult.value;
      const inventoryResponse = inventoryResult.value;

      if (clientesResponse.error) throw clientesResponse.error;
      if (productosResponse.error) throw productosResponse.error;
      if (ventasResponse.error) throw ventasResponse.error;
      if (cotizacionesResponse.error) throw cotizacionesResponse.error;
      if (inventoryResponse.error) throw inventoryResponse.error;

      setClientes(clientesResponse.data || []);
      setProductos(productosResponse.data || []);
      setVentas(ventasResponse.data || []);
      setCotizaciones(cotizacionesResponse.data || []);
      setInventoryMovements((inventoryResponse.data || []).map(normalizeMovement));
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudieron cargar los reportes.");
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    const printableWindow = window.open("", "_blank", "width=1100,height=900");
    if (!printableWindow) {
      setErrorMessage("El navegador bloqueo la ventana de impresion del reporte.");
      return;
    }

    printableWindow.document.write(buildReportHtml({
      companyName,
      reportConfig,
    }));
    printableWindow.document.close();
    printableWindow.focus();
    printableWindow.print();
  }

  function handleWhatsAppShare() {
    const summaryLines = reportConfig.summary.map((item) => `${item.label}: ${item.value}`).join("\n");
    const topRows = reportConfig.rows.slice(0, 5).map((row) => `- ${row.join(" | ")}`).join("\n");
    const text = encodeURIComponent(
      `${companyName}\n${reportConfig.title}\n${reportConfig.subtitle}\n\n${summaryLines}\n\n${topRows}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      <div className="page-header">
        <h1>Reportes</h1>
        <p>Consulta informacion comercial consolidada y comparte reportes de forma rapida.</p>
      </div>

      <div className="reports-shell">
        <section className="module-card reports-selector-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Centro de reportes</h2>
              <p className="section-copy">Selecciona el tipo de reporte y genera una vista lista para imprimir o compartir.</p>
            </div>
            <button type="button" className="secondary-btn" onClick={loadReports} disabled={loading}>
              {loading ? "Actualizando..." : "Recargar"}
            </button>
          </div>

          <div className="reports-tabs">
            {REPORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`reports-tab ${selectedReport === option.id ? "reports-tab-active" : ""}`}
                onClick={() => setSelectedReport(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="module-card reports-summary-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">{reportConfig.title}</h2>
              <p className="section-copy">{reportConfig.subtitle}</p>
            </div>
            <div className="reports-actions">
              <button type="button" className="secondary-btn" onClick={handleWhatsAppShare}>
                Enviar por WhatsApp
              </button>
              <button type="button" className="primary-btn" onClick={handlePrint}>
                Imprimir reporte
              </button>
            </div>
          </div>

          {errorMessage ? <p className="form-message form-message-error">{errorMessage}</p> : null}

          <div className="reports-metrics-grid">
            {reportConfig.summary.map((item) => (
              <div key={item.label} className="reports-metric-card">
                <span className="quotes-summary-label">{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="table-wrap reports-table-wrap">
            <table className="table reports-table">
              <thead>
                <tr>
                  {reportConfig.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reportConfig.rows.length > 0 ? (
                  reportConfig.rows.map((row, rowIndex) => (
                    <tr key={`${selectedReport}-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${selectedReport}-${rowIndex}-${cellIndex}`}>{cell}</td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={reportConfig.columns.length}>
                      {loading ? "Cargando informacion..." : "No hay datos disponibles para este reporte."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
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

function buildReportHtml({ companyName, reportConfig }) {
  const tableHead = reportConfig.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const tableBody = reportConfig.rows.length
    ? reportConfig.rows
        .map(
          (row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${reportConfig.columns.length}">No hay datos disponibles para este reporte.</td></tr>`;
  const summary = reportConfig.summary
    .map((item) => `<div class="metric"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`)
    .join("");

  return `
    <html>
      <head>
        <title>${escapeHtml(reportConfig.title)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 28px; color: #0f172a; }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
          h1 { margin: 0 0 6px; font-size: 28px; }
          p { margin: 0; color: #64748b; }
          .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
          .metric { padding: 14px; border: 1px solid #dbeafe; border-radius: 16px; background: #f8fbff; }
          .metric span { display: block; font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 700; margin-bottom: 6px; }
          .metric strong { font-size: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: left; font-size: 13px; }
          th { background: #0f172a; color: #fff; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>${escapeHtml(reportConfig.title)}</h1>
            <p>${escapeHtml(companyName)}</p>
          </div>
          <div>${escapeHtml(new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date()))}</div>
        </div>
        <p style="margin-bottom: 20px;">${escapeHtml(reportConfig.subtitle)}</p>
        <div class="metrics">${summary}</div>
        <table>
          <thead><tr>${tableHead}</tr></thead>
          <tbody>${tableBody}</tbody>
        </table>
      </body>
    </html>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function labelForPaymentMethod(value) {
  const labels = {
    efectivo: "Efectivo",
    transferencia: "Transferencia",
    tarjeta: "Tarjeta",
  };

  return labels[value] || "Sin metodo";
}

function statusLabel(status) {
  if (status === "autorizada") return "Autorizada";
  if (status === "rechazada") return "No autorizada";
  return "Pendiente";
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatQuantity(value) {
  return new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}
