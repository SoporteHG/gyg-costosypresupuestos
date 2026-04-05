import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const initialForm = {
  producto_id: "",
  tipo_movimiento: "entrada",
  cantidad: "",
  referencia: "",
  notas: "",
};

const REQUEST_TIMEOUT_MS = 10000;
const INVENTORY_SCHEMA_HELP =
  "Verifica en Supabase que existan la tabla inventory_movements, sus politicas RLS y las columnas company_id, product_id, movement_type, quantity y note.";

export default function InventarioPage({ currentUser, companyId }) {
  const [productos, setProductos] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusDetail, setStatusDetail] = useState("Preparando carga...");

  useEffect(() => {
    loadInventario();
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

  function getMyCompanyId() {
    setStatusDetail("Validando empresa activa...");

    if (!currentUser?.id || !companyId) {
      throw new Error("No se encontro la empresa activa del usuario.");
    }

    return companyId;
  }

  async function loadInventario() {
    try {
      setLoading(true);
      setErrorMessage("");
      setMessage("");
      setStatusDetail("Consultando inventario...");

      const currentCompanyId = getMyCompanyId();

      const [productosResponse, movimientosResponse] = await Promise.all([
        withTimeout(
          supabase
            .from("productos")
            .select("id, nombre, sku, unidad")
            .eq("tenant_id", currentCompanyId)
            .is("deleted_at", null)
            .order("nombre", { ascending: true }),
          "consultar productos para inventario"
        ),
        withTimeout(
          supabase
            .from("inventory_movements")
            .select("id, company_id, product_id, movement_type, quantity, stock_before, stock_after, unit_cost, note, created_at")
            .eq("company_id", currentCompanyId)
            .order("created_at", { ascending: false }),
          "consultar movimientos de inventario"
        ),
      ]);

      if (productosResponse.error) throw productosResponse.error;
      if (movimientosResponse.error) throw movimientosResponse.error;

      setProductos(productosResponse.data || []);
      setMovimientos((movimientosResponse.data || []).map(normalizeMovement));
      setStatusDetail(
        `Carga completa: ${movimientosResponse.data?.length || 0} movimiento(s) y ${productosResponse.data?.length || 0} producto(s).`
      );
    } catch (error) {
      console.error(error);
      setErrorMessage(buildInventoryErrorMessage(error, "No se pudo cargar el inventario."));
      setStatusDetail("La carga se detuvo.");
    } finally {
      setLoading(false);
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Guardando movimiento...");

      const resolvedCompanyId = companyId || getMyCompanyId();
      const quantity = Number(form.cantidad);

      if (!form.producto_id) {
        throw new Error("Selecciona un producto para registrar el movimiento.");
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Captura una cantidad valida mayor a cero.");
      }

      const currentStock = movimientos
        .filter((movimiento) => movimiento.producto_id === form.producto_id)
        .reduce((total, movimiento) => {
          return total + (movimiento.tipo_movimiento === "salida" ? -movimiento.cantidad : movimiento.cantidad);
        }, 0);

      const stockAfter =
        form.tipo_movimiento === "salida" ? currentStock - quantity : currentStock + quantity;

      const payload = {
        company_id: resolvedCompanyId,
        product_id: form.producto_id,
        movement_type: form.tipo_movimiento,
        quantity,
        stock_before: currentStock,
        stock_after: stockAfter,
        note: [form.referencia.trim(), form.notas.trim()].filter(Boolean).join(" | ") || null,
      };

      const { error } = await withTimeout(
        supabase.from("inventory_movements").insert(payload),
        "crear movimiento de inventario"
      );

      if (error) throw error;

      setForm(initialForm);
      setMessage("Movimiento de inventario registrado correctamente.");
      setStatusDetail("Movimiento guardado. Sincronizando historial...");
      await loadInventario();
    } catch (error) {
      console.error(error);
      setErrorMessage(buildInventoryErrorMessage(error, "No se pudo guardar el movimiento."));
      setStatusDetail("No se pudo completar el guardado.");
    } finally {
      setSaving(false);
    }
  }

  const selectedProduct = useMemo(
    () => productos.find((producto) => producto.id === form.producto_id) || null,
    [productos, form.producto_id]
  );

  const productMap = useMemo(() => {
    return productos.reduce((accumulator, producto) => {
      accumulator[producto.id] = producto;
      return accumulator;
    }, {});
  }, [productos]);

  const inventorySummary = useMemo(() => {
    const base = {};

    for (const producto of productos) {
      base[producto.id] = {
        id: producto.id,
        nombre: producto.nombre,
        sku: producto.sku,
        unidad: producto.unidad,
        existencia: 0,
      };
    }

    for (const movimiento of movimientos) {
      const producto = productMap[movimiento.producto_id];

      if (!base[movimiento.producto_id]) {
        base[movimiento.producto_id] = {
          id: movimiento.producto_id,
          nombre: producto?.nombre || "Producto",
          sku: producto?.sku || "",
          unidad: producto?.unidad || "",
          existencia: 0,
        };
      }

      const delta = movimiento.tipo_movimiento === "salida" ? -movimiento.cantidad : movimiento.cantidad;
      base[movimiento.producto_id].existencia += delta;
    }

    return Object.values(base).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [movimientos, productos, productMap]);

  return (
    <div>
      <div className="page-header">
        <h1>Inventario</h1>
        <p>Controla entradas y salidas para mantener existencias actualizadas por empresa.</p>
      </div>

      <div className="inventory-layout">
        <section className="module-card inventory-form-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Nuevo movimiento</h2>
              <p className="section-copy">
                Registra entradas por compra o ajustes, y salidas por consumo, venta o merma.
              </p>
            </div>
          </div>

          <form className="inventory-form" onSubmit={handleSubmit}>
            <div className="inventory-form-grid">
              <div className="form-group">
                <label>Producto</label>
                <select
                  className="quotes-select"
                  name="producto_id"
                  value={form.producto_id}
                  onChange={handleChange}
                  required
                >
                  <option value="">Selecciona un producto</option>
                  {productos.map((producto) => (
                    <option key={producto.id} value={producto.id}>
                      {producto.nombre} {producto.sku ? `(${producto.sku})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Tipo</label>
                <select
                  className="quotes-select"
                  name="tipo_movimiento"
                  value={form.tipo_movimiento}
                  onChange={handleChange}
                >
                  <option value="entrada">Entrada</option>
                  <option value="salida">Salida</option>
                </select>
              </div>

              <div className="form-group inventory-number-field">
                <label>Cantidad</label>
                <input
                  name="cantidad"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.cantidad}
                  onChange={handleChange}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="form-group">
                <label>Referencia</label>
                <input
                  name="referencia"
                  value={form.referencia}
                  onChange={handleChange}
                  placeholder="Compra, ajuste, venta, remision..."
                />
              </div>

              <div className="form-group form-group-full">
                <label>Notas</label>
                <textarea
                  name="notas"
                  value={form.notas}
                  onChange={handleChange}
                  rows="3"
                  placeholder="Detalle opcional del movimiento"
                />
              </div>
            </div>

            {selectedProduct ? (
              <div className="inventory-product-chip">
                <div>
                  <span className="quotes-summary-label">Producto</span>
                  <strong>{selectedProduct.nombre}</strong>
                </div>
                <div>
                  <span className="quotes-summary-label">SKU</span>
                  <strong>{selectedProduct.sku || "Sin SKU"}</strong>
                </div>
                <div>
                  <span className="quotes-summary-label">Unidad</span>
                  <strong>{selectedProduct.unidad || "Sin unidad"}</strong>
                </div>
              </div>
            ) : null}

            <div className="settings-actions inventory-actions">
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? "Guardando..." : "Registrar movimiento"}
              </button>
            </div>
          </form>
        </section>

        <section className="module-card inventory-stock-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Existencias actuales</h2>
              <p className="section-copy">
                Resumen calculado con base en entradas y salidas registradas.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table inventory-stock-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Unidad</th>
                  <th>Existencia</th>
                </tr>
              </thead>
              <tbody>
                {inventorySummary.map((item) => (
                  <tr key={item.id}>
                    <td>{item.sku || "-"}</td>
                    <td>{item.nombre}</td>
                    <td>{item.unidad || "-"}</td>
                    <td>{formatQuantity(item.existencia)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="module-card inventory-history-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Historial de movimientos</h2>
              <p className="section-copy">
                {loading ? "Cargando movimientos..." : `${movimientos.length} movimiento(s) encontrados.`}
              </p>
              <p className="section-copy">{statusDetail}</p>
            </div>

            <button type="button" className="secondary-btn" onClick={loadInventario} disabled={loading}>
              {loading ? "Actualizando..." : "Recargar"}
            </button>
          </div>

          {errorMessage ? <p className="form-message form-message-error">{errorMessage}</p> : null}
          {message ? <p className="form-message form-message-success">{message}</p> : null}

          {!loading && movimientos.length === 0 && !errorMessage ? (
            <div className="empty-state">
              <strong>No hay movimientos registrados todavia.</strong>
              <span>Usa el formulario superior para cargar la primera entrada o salida.</span>
            </div>
          ) : null}

          {movimientos.length > 0 ? (
            <div className="table-wrap">
              <table className="table inventory-history-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Producto</th>
                    <th>SKU</th>
                    <th>Tipo</th>
                    <th>Cantidad</th>
                    <th>Nota</th>
                    <th>Stock antes</th>
                    <th>Stock despues</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((movimiento) => {
                    const producto = productMap[movimiento.producto_id];

                    return (
                      <tr key={movimiento.id}>
                        <td>{formatDate(movimiento.created_at)}</td>
                        <td>{producto?.nombre || "Producto"}</td>
                        <td>{producto?.sku || "-"}</td>
                        <td>
                          <span
                            className={
                              movimiento.tipo_movimiento === "salida"
                                ? "status-chip status-chip-danger"
                                : "status-chip status-chip-success"
                            }
                          >
                            {movimiento.tipo_movimiento === "salida" ? "Salida" : "Entrada"}
                          </span>
                        </td>
                        <td>{formatQuantity(movimiento.cantidad)}</td>
                        <td className="inventory-notes-cell">{movimiento.notas || "-"}</td>
                        <td>{formatQuantity(movimiento.stock_before)}</td>
                        <td>{formatQuantity(movimiento.stock_after)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function normalizeMovement(row) {
  return {
    id: row.id,
    company_id: row.company_id || null,
    producto_id: row.product_id || null,
    tipo_movimiento: row.movement_type || "entrada",
    cantidad: Number(row.quantity || 0),
    stock_before: Number(row.stock_before || 0),
    stock_after: Number(row.stock_after || 0),
    notas: row.note || "",
    created_at: row.created_at || null,
  };
}

function buildInventoryErrorMessage(error, fallbackMessage) {
  const baseMessage = error?.message || fallbackMessage;

  if (
    baseMessage.includes("relation") ||
    baseMessage.includes("column") ||
    baseMessage.includes("schema cache") ||
    baseMessage.includes("permission denied")
  ) {
    return `${baseMessage} ${INVENTORY_SCHEMA_HELP}`;
  }

  return baseMessage;
}

function formatDate(value) {
  if (!value) return "-";

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
