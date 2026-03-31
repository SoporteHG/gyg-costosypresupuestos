import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_IVA_RATE = 16;
const POS_SCHEMA_HELP = "La tabla de ventas del mini POS necesita las columnas nuevas. Ejecuta el SQL de ventas y venta_items en Supabase y vuelve a intentar.";
const CASH_SHORTCUTS = [100, 200, 500, 1000];
const PAYMENT_OPTIONS = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "tarjeta", label: "Tarjeta" },
];

const initialCartItem = {
  id: crypto.randomUUID(),
  productoId: "",
  sku: "",
  nombre: "",
  unidad: "",
  cantidad: "1",
  precio: "0",
};

export default function PuntoVentaPage({ currentUser, companyId, company, branding }) {
  const [clientes, setClientes] = useState([]);
  const [productos, setProductos] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [cashSession, setCashSession] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [amountReceived, setAmountReceived] = useState("");
  const [notes, setNotes] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");
  const [closingAmount, setClosingAmount] = useState("");
  const [ivaRate, setIvaRate] = useState(String(DEFAULT_IVA_RATE));
  const [cartItems, setCartItems] = useState([{ ...initialCartItem, id: crypto.randomUUID() }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusDetail, setStatusDetail] = useState("Preparando punto de venta...");
  const [lastTicket, setLastTicket] = useState(null);

  useEffect(() => {
    loadPosData();
  }, [currentUser?.id, companyId]);

  const selectedClient = useMemo(
    () => clientes.find((cliente) => cliente.id === selectedClientId) || null,
    [clientes, selectedClientId]
  );

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return productos.slice(0, 12);

    return productos
      .filter((producto) => {
        const haystack = [producto.sku, producto.nombre, producto.categoria, producto.marca]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 12);
  }, [productos, search]);

  const cartCount = useMemo(
    () => cartItems.filter((item) => item.nombre && Number(item.cantidad || 0) > 0).length,
    [cartItems]
  );

  const totals = useMemo(() => {
    const subtotal = cartItems.reduce((accumulator, item) => {
      const cantidad = Number(item.cantidad || 0);
      const precio = Number(item.precio || 0);
      return accumulator + cantidad * precio;
    }, 0);

    const normalizedIvaRate = Number(ivaRate || 0);
    const ivaAmount = subtotal * (normalizedIvaRate / 100);
    const total = subtotal + ivaAmount;
    const received = Number(amountReceived || 0);
    const change = paymentMethod === "efectivo" ? Math.max(received - total, 0) : 0;
    const pending = paymentMethod === "efectivo" ? Math.max(total - received, 0) : 0;

    return {
      subtotal,
      ivaRate: normalizedIvaRate,
      ivaAmount,
      total,
      received,
      change,
      pending,
    };
  }, [cartItems, ivaRate, amountReceived, paymentMethod]);

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

  function requireCompanyId() {
    if (!currentUser?.id || !companyId) {
      throw new Error("No se encontro la empresa activa para el punto de venta.");
    }

    return companyId;
  }

  async function loadPosData() {
    try {
      setLoading(true);
      setErrorMessage("");
      setMessage("");

      const tenantId = requireCompanyId();
      setStatusDetail("Cargando clientes, productos y ventas...");

      const [clientesResult, productosResult, ventasResult, cashSessionResult] = await Promise.allSettled([
        withTimeout(
          supabase
            .from("clientes")
            .select("id, nombre, empresa, telefono, email")
            .eq("tenant_id", tenantId)
            .order("nombre", { ascending: true }),
          "consultar clientes"
        ),
        withTimeout(
          supabase
            .from("productos")
            .select("id, sku, nombre, categoria, marca, unidad, precio")
            .eq("tenant_id", tenantId)
            .order("nombre", { ascending: true }),
          "consultar productos"
        ),
        withTimeout(
          supabase
            .from("ventas")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false })
            .limit(8),
          "consultar ventas"
        ),
        withTimeout(
          supabase
            .from("cash_sessions")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("status", "open")
            .order("opened_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          "consultar caja activa"
        ),
      ]);

      if (clientesResult.status === "rejected") throw clientesResult.reason;
      if (productosResult.status === "rejected") throw productosResult.reason;

      const clientesResponse = clientesResult.value;
      const productosResponse = productosResult.value;

      if (clientesResponse.error) throw clientesResponse.error;
      if (productosResponse.error) throw productosResponse.error;

      setClientes(clientesResponse.data || []);
      setProductos(productosResponse.data || []);

      if (ventasResult.status === "fulfilled" && !ventasResult.value.error) {
        setVentas((ventasResult.value.data || []).map(normalizeVenta));
      } else {
        setVentas([]);
        const ventasError =
          ventasResult.status === "rejected"
            ? ventasResult.reason?.message
            : ventasResult.value.error?.message;

        if (ventasError) {
          setErrorMessage(buildPosErrorMessage(ventasError));
        }
      }

      if (cashSessionResult.status === "fulfilled" && !cashSessionResult.value.error) {
        const activeSession = cashSessionResult.value.data || null;
        setCashSession(activeSession);
        if (activeSession?.opening_amount != null) {
          setOpeningAmount(String(activeSession.opening_amount));
        }
      } else {
        setCashSession(null);
      }

      setStatusDetail(
        `Carga completa: ${productosResponse.data?.length || 0} producto(s), ${clientesResponse.data?.length || 0} cliente(s).`
      );
    } catch (error) {
      console.error(error);
      setErrorMessage(buildPosErrorMessage(error.message || "No se pudo cargar el punto de venta."));
      setStatusDetail("La carga se detuvo.");
    } finally {
      setLoading(false);
    }
  }

  function addProductToCart(producto) {
    setCartItems((previous) => {
      const existingItem = previous.find((item) => item.productoId === producto.id);
      if (existingItem) {
        return previous.map((item) =>
          item.productoId === producto.id
            ? { ...item, cantidad: String(Number(item.cantidad || 0) + 1) }
            : item
        );
      }

      return [
        ...previous,
        {
          id: crypto.randomUUID(),
          productoId: producto.id,
          sku: producto.sku || "",
          nombre: producto.nombre || "",
          unidad: producto.unidad || "",
          cantidad: "1",
          precio: String(producto.precio ?? 0),
        },
      ];
    });
  }

  function updateCartItem(itemId, field, value) {
    setCartItems((previous) =>
      previous.map((item) => (item.id === itemId ? { ...item, [field]: value } : item))
    );
  }

  function removeCartItem(itemId) {
    setCartItems((previous) => {
      if (previous.length === 1) {
        return [{ ...initialCartItem, id: crypto.randomUUID() }];
      }

      return previous.filter((item) => item.id !== itemId);
    });
  }

  function resetSale() {
    setSelectedClientId("");
    setPaymentMethod("efectivo");
    setAmountReceived("");
    setNotes("");
    setIvaRate(String(DEFAULT_IVA_RATE));
    setSearch("");
    setCartItems([{ ...initialCartItem, id: crypto.randomUUID() }]);
  }

  async function handleOpenCashSession() {
    try {
      setSaving(true);
      setMessage("");
      setErrorMessage("");

      const tenantId = requireCompanyId();
      const amount = Number(openingAmount || 0);

      const { data, error } = await withTimeout(
        supabase
          .from("cash_sessions")
          .insert({
            tenant_id: tenantId,
            opened_by: currentUser?.id || null,
            opening_amount: amount,
            status: "open",
          })
          .select("*")
          .single(),
        "abrir caja"
      );

      if (error) throw error;

      setCashSession(data);
      setMessage("Caja abierta correctamente.");
      setStatusDetail("Caja abierta y lista para cobrar.");
    } catch (error) {
      console.error(error);
      setErrorMessage(buildPosErrorMessage(error.message || "No se pudo abrir la caja."));
    } finally {
      setSaving(false);
    }
  }

  async function handleCloseCashSession() {
    try {
      if (!cashSession?.id) {
        throw new Error("No hay una caja abierta.");
      }

      setSaving(true);
      setMessage("");
      setErrorMessage("");

      const countedAmount = Number(closingAmount || 0);
      const expectedCash = Number(cashSession.opening_amount || 0) + ventas
        .filter((venta) => venta.cash_session_id === cashSession.id && venta.payment_method === "efectivo")
        .reduce((sum, venta) => sum + Number(venta.total || 0), 0);
      const difference = countedAmount - expectedCash;

      const { data, error } = await withTimeout(
        supabase
          .from("cash_sessions")
          .update({
            closed_by: currentUser?.id || null,
            closing_amount: countedAmount,
            expected_cash: expectedCash,
            difference,
            status: "closed",
            closed_at: new Date().toISOString(),
          })
          .eq("id", cashSession.id)
          .select("*")
          .single(),
        "cerrar caja"
      );

      if (error) throw error;

      setCashSession(null);
      setClosingAmount("");
      setMessage(
        `Caja cerrada. Esperado: ${formatCurrency(data.expected_cash)}. Diferencia: ${formatCurrency(data.difference)}.`
      );
      setStatusDetail("Caja cerrada correctamente.");
    } catch (error) {
      console.error(error);
      setErrorMessage(buildPosErrorMessage(error.message || "No se pudo cerrar la caja."));
    } finally {
      setSaving(false);
    }
  }

  function applyCashShortcut(value) {
    if (value === "exacto") {
      setAmountReceived(String(Number(totals.total.toFixed(2))));
      return;
    }

    setAmountReceived(String(value));
  }

  function buildCurrentTicket(ticketBase) {
    const brandName = branding?.business_name || company?.name || "Tu empresa";
    return {
      ...ticketBase,
      companyName: brandName,
      companyPhone: branding?.phone || "",
      companyAddress: branding?.address || "",
      companyEmail: branding?.email || currentUser?.email || "",
      logoUrl: branding?.logo_url || company?.logo_url || "",
      items: ticketBase.items || [],
      subtotal: ticketBase.subtotal,
      ivaAmount: ticketBase.iva_amount,
      ivaRate: ticketBase.iva_rate,
      total: ticketBase.total,
      amountReceived: paymentMethod === "efectivo" ? totals.received : ticketBase.total,
      change: paymentMethod === "efectivo" ? totals.change : 0,
    };
  }

  function handlePrintTicket(ticket) {
    const printableWindow = window.open("", "_blank", "width=520,height=820");
    if (!printableWindow) {
      setErrorMessage("El navegador bloqueo la ventana de impresion del ticket.");
      return;
    }

    printableWindow.document.write(buildTicketHtml(ticket));
    printableWindow.document.close();
    printableWindow.focus();
    printableWindow.print();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Guardando venta...");

      const tenantId = requireCompanyId();

      const normalizedItems = cartItems
        .map((item) => ({
          producto_id: item.productoId || null,
          sku: item.sku || null,
          producto_nombre: item.nombre || null,
          unidad: item.unidad || null,
          cantidad: Number(item.cantidad || 0),
          precio_unitario: Number(item.precio || 0),
          total: Number(item.cantidad || 0) * Number(item.precio || 0),
        }))
        .filter((item) => item.producto_nombre && item.cantidad > 0);

      if (!normalizedItems.length) {
        throw new Error("Agrega al menos un producto valido al carrito.");
      }

      if (!cashSession?.id) {
        throw new Error("Primero necesitas abrir una caja para poder cobrar.");
      }

      if (paymentMethod === "efectivo" && totals.received < totals.total) {
        throw new Error("El efectivo recibido es menor al total de la venta.");
      }

      const createdAt = new Date().toISOString();
      const folio = buildSaleNumber(createdAt);
      const salePayload = {
        tenant_id: tenantId,
        folio,
        cliente_id: selectedClient?.id || null,
        cliente_nombre: selectedClient?.nombre || "Venta mostrador",
        cash_session_id: cashSession.id,
        payment_method: paymentMethod,
        notas: notes.trim() || null,
        subtotal: totals.subtotal,
        iva_rate: totals.ivaRate,
        iva_amount: totals.ivaAmount,
        total: totals.total,
        created_at: createdAt,
      };

      const { data: venta, error: ventaError } = await withTimeout(
        supabase.from("ventas").insert(salePayload).select("*").single(),
        "crear venta"
      );

      if (ventaError) throw ventaError;

      const itemsPayload = normalizedItems.map((item) => ({
        venta_id: venta.id,
        tenant_id: tenantId,
        ...item,
      }));

      const { error: itemsError } = await withTimeout(
        supabase.from("venta_items").insert(itemsPayload),
        "crear partidas de venta"
      );

      if (itemsError) {
        await supabase.from("ventas").delete().eq("id", venta.id);
        throw itemsError;
      }

      const normalizedVenta = normalizeVenta(venta);
      const printableTicket = buildCurrentTicket({
        ...normalizedVenta,
        items: normalizedItems,
        subtotal: totals.subtotal,
        iva_amount: totals.ivaAmount,
        iva_rate: totals.ivaRate,
        total: totals.total,
      });

      setVentas((previous) => [normalizedVenta, ...previous].slice(0, 8));
      setLastTicket(printableTicket);
      setMessage("Venta registrada correctamente.");
      setStatusDetail("Venta guardada.");
      resetSale();
    } catch (error) {
      console.error(error);
      setErrorMessage(buildPosErrorMessage(error.message || "No se pudo guardar la venta."));
      setStatusDetail("No se pudo completar el cobro.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Punto de Venta</h1>
        <p>Registra ventas rapidas por empresa, agrega productos al carrito y guarda los cobros del dia.</p>
      </div>

      <section className="module-card pos-overview-card">
        <div className="pos-overview-strip">
          <div className="pos-overview-pill">
            <span className="quotes-summary-label">Productos listos</span>
            <strong>{productos.length}</strong>
          </div>
          <div className="pos-overview-pill">
            <span className="quotes-summary-label">Cliente activo</span>
            <strong>{selectedClient?.nombre || "Mostrador"}</strong>
          </div>
          <div className="pos-overview-pill">
            <span className="quotes-summary-label">Metodo</span>
            <strong>{labelForPaymentMethod(paymentMethod)}</strong>
          </div>
          <div className="pos-overview-pill">
            <span className="quotes-summary-label">Caja</span>
            <strong>{cashSession ? "Abierta" : "Cerrada"}</strong>
          </div>
          <div className="pos-overview-pill pos-overview-pill-total">
            <span className="quotes-summary-label">Total actual</span>
            <strong>{formatCurrency(totals.total)}</strong>
          </div>
        </div>
      </section>

      <div className="pos-layout">
        <section className="module-card pos-cash-session-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Control de caja</h2>
              <p className="section-copy">
                {cashSession
                  ? `Caja abierta desde ${formatDate(cashSession.opened_at)}`
                  : "Abre una caja para comenzar a registrar ventas."}
              </p>
            </div>
          </div>

          <div className="pos-cash-session-grid">
            <div className="form-group pos-number-field">
              <label>Monto inicial</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openingAmount}
                onChange={(event) => setOpeningAmount(event.target.value)}
                disabled={Boolean(cashSession)}
              />
            </div>
            <button
              type="button"
              className="primary-btn"
              onClick={handleOpenCashSession}
              disabled={saving || Boolean(cashSession)}
            >
              Abrir caja
            </button>

            <div className="form-group pos-number-field">
              <label>Efectivo contado</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={closingAmount}
                onChange={(event) => setClosingAmount(event.target.value)}
                disabled={!cashSession}
              />
            </div>
            <button
              type="button"
              className="secondary-btn"
              onClick={handleCloseCashSession}
              disabled={saving || !cashSession}
            >
              Cerrar caja
            </button>
          </div>

          {cashSession ? (
            <div className="pos-cash-session-summary">
              <div>
                <span className="quotes-summary-label">Fondo inicial</span>
                <strong>{formatCurrency(cashSession.opening_amount)}</strong>
              </div>
              <div>
                <span className="quotes-summary-label">Abierta por</span>
                <strong>{currentUser?.email || "Usuario"}</strong>
              </div>
            </div>
          ) : null}
        </section>

        <div className="pos-main-grid">
          <section className="module-card pos-search-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">Productos</h2>
                <p className="section-copy">Busca por SKU, nombre o escanea con lector de codigo de barras.</p>
              </div>
              <button type="button" className="secondary-btn" onClick={loadPosData} disabled={loading}>
                {loading ? "Actualizando..." : "Recargar"}
              </button>
            </div>

            <div className="pos-search-bar">
              <div className="form-group pos-search-input">
                <label>Buscar producto</label>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="SKU, nombre, categoria o marca"
                />
              </div>

              <div className="pos-search-meta">
                <span className="quotes-summary-label">Resultados</span>
                <strong>{filteredProducts.length}</strong>
              </div>
            </div>

            <div className="pos-products-grid">
              {filteredProducts.map((producto) => (
                <button
                  key={producto.id}
                  type="button"
                  className="pos-product-card"
                  onClick={() => addProductToCart(producto)}
                >
                  <span className="pos-product-sku">{producto.sku || "Sin SKU"}</span>
                  <strong>{producto.nombre}</strong>
                  <span>{producto.categoria || "Sin categoria"}</span>
                  <span>{producto.unidad || "Unidad"}</span>
                  <strong>{formatCurrency(producto.precio)}</strong>
                </button>
              ))}

              {!filteredProducts.length ? (
                <div className="empty-state">
                  <strong>No se encontraron productos.</strong>
                  <span>Prueba con otro SKU o nombre.</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="module-card pos-cart-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">Ticket actual</h2>
                <p className="section-copy">Ajusta cantidades, selecciona pago y cobra sin salir de esta vista.</p>
              </div>
            </div>

            <form className="pos-form" onSubmit={handleSubmit}>
              <div className="pos-top-grid">
                <div className="form-group">
                  <label>Cliente</label>
                  <select
                    value={selectedClientId}
                    onChange={(event) => setSelectedClientId(event.target.value)}
                    className="quotes-select"
                  >
                    <option value="">Venta mostrador</option>
                    {clientes.map((cliente) => (
                      <option key={cliente.id} value={cliente.id}>
                        {cliente.nombre}{cliente.empresa ? ` - ${cliente.empresa}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group form-group-full pos-payment-group">
                  <label>Metodo de pago</label>
                  <div className="pos-payment-methods">
                    {PAYMENT_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`pos-payment-btn ${paymentMethod === option.id ? "pos-payment-btn-active" : ""}`}
                        onClick={() => setPaymentMethod(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group pos-number-field">
                  <label>IVA (%)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={ivaRate}
                    onChange={(event) => setIvaRate(event.target.value)}
                  />
                </div>
              </div>

              <div className="pos-client-chip">
                <div>
                  <span className="quotes-summary-label">Cliente activo</span>
                  <strong>{selectedClient?.nombre || "Mostrador"}</strong>
                </div>
                <div>
                  <span className="quotes-summary-label">Telefono</span>
                  <strong>{selectedClient?.telefono || "Sin telefono"}</strong>
                </div>
                <div>
                  <span className="quotes-summary-label">Correo</span>
                  <strong>{selectedClient?.email || "Sin correo"}</strong>
                </div>
              </div>

              <div className="pos-cart-head">
                <h3 className="quotes-items-title">Carrito</h3>
                <span className="pos-cart-counter">{cartCount} concepto(s)</span>
              </div>

              <div className="pos-cart-list">
                {cartItems.map((item, index) => (
                  <div key={item.id} className="pos-cart-row">
                    <div className="form-group">
                      <label>Producto #{index + 1}</label>
                      <input value={item.nombre} readOnly placeholder="Selecciona desde busqueda rapida" />
                    </div>
                    <div className="form-group">
                      <label>SKU</label>
                      <input value={item.sku} readOnly />
                    </div>
                    <div className="form-group">
                      <label>Unidad</label>
                      <input value={item.unidad} readOnly />
                    </div>
                    <div className="form-group pos-number-field">
                      <label>Cantidad</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.cantidad}
                        onChange={(event) => updateCartItem(item.id, "cantidad", event.target.value)}
                      />
                    </div>
                    <div className="form-group pos-number-field">
                      <label>Precio</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.precio}
                        onChange={(event) => updateCartItem(item.id, "precio", event.target.value)}
                      />
                    </div>
                    <div className="pos-line-total">
                      <span>Total</span>
                      <strong>{formatCurrency(Number(item.cantidad || 0) * Number(item.precio || 0))}</strong>
                    </div>
                    <button
                      type="button"
                      className="table-action-btn table-action-btn-danger"
                      onClick={() => removeCartItem(item.id)}
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>

              <div className="pos-cash-grid">
                <div className="form-group pos-number-field">
                  <label>Recibido</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountReceived}
                    onChange={(event) => setAmountReceived(event.target.value)}
                    disabled={paymentMethod !== "efectivo"}
                    placeholder={paymentMethod === "efectivo" ? "0.00" : "No aplica"}
                  />
                </div>
                <div className="pos-cash-result">
                  <span className="quotes-summary-label">Cambio</span>
                  <strong>{formatCurrency(totals.change)}</strong>
                  {paymentMethod === "efectivo" && totals.pending > 0 ? (
                    <small>Faltan {formatCurrency(totals.pending)}</small>
                  ) : (
                    <small>{paymentMethod === "efectivo" ? "Cobro cubierto" : "Pago no en efectivo"}</small>
                  )}
                </div>
              </div>

              {paymentMethod === "efectivo" ? (
                <div className="pos-cash-shortcuts">
                  <button type="button" className="secondary-btn" onClick={() => applyCashShortcut("exacto")}>
                    Exacto
                  </button>
                  {CASH_SHORTCUTS.map((shortcut) => (
                    <button
                      key={shortcut}
                      type="button"
                      className="secondary-btn"
                      onClick={() => applyCashShortcut(shortcut)}
                    >
                      {formatCurrency(shortcut)}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="form-group form-group-full">
                <label>Notas</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows="3"
                  placeholder="Referencia de pago, observaciones, descuentos manuales..."
                />
              </div>

              <div className="quotes-summary-panel pos-summary-panel">
                <div>
                  <span className="quotes-summary-label">Subtotal</span>
                  <strong>{formatCurrency(totals.subtotal)}</strong>
                </div>
                <div>
                  <span className="quotes-summary-label">IVA ({totals.ivaRate}%)</span>
                  <strong>{formatCurrency(totals.ivaAmount)}</strong>
                </div>
                <div>
                  <span className="quotes-summary-label">Total</span>
                  <strong>{formatCurrency(totals.total)}</strong>
                </div>
              </div>

              <div className="settings-actions quotes-actions">
                <button type="submit" className="primary-btn" disabled={saving}>
                  {saving ? "Cobrando..." : "Cobrar"}
                </button>
                <button type="button" className="secondary-btn" onClick={resetSale}>
                  Limpiar venta
                </button>
                {lastTicket ? (
                  <button type="button" className="secondary-btn" onClick={() => handlePrintTicket(lastTicket)}>
                    Imprimir ticket
                  </button>
                ) : null}
              </div>
            </form>
          </section>
        </div>

        {lastTicket ? (
          <section className="module-card pos-ticket-preview-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">Ultimo ticket</h2>
                <p className="section-copy">Vista rapida de la ultima venta cobrada.</p>
              </div>
              <button type="button" className="secondary-btn" onClick={() => handlePrintTicket(lastTicket)}>
                Imprimir ticket
              </button>
            </div>

            <div className="pos-ticket-preview">
              {lastTicket.logoUrl ? (
                <img src={lastTicket.logoUrl} alt={lastTicket.companyName} className="pos-ticket-preview-logo" />
              ) : null}
              <strong>{lastTicket.companyName}</strong>
              <span className="pos-ticket-preview-folio">{lastTicket.folio}</span>
              <span>{formatDate(lastTicket.created_at)}</span>
              <span>{lastTicket.cliente_nombre || "Venta mostrador"}</span>
              <div className="pos-ticket-preview-total">
                <span>Total</span>
                <strong>{formatCurrency(lastTicket.total)}</strong>
              </div>
              <div className="pos-ticket-preview-total">
                <span>Recibido</span>
                <strong>{formatCurrency(lastTicket.amountReceived)}</strong>
              </div>
              <div className="pos-ticket-preview-total">
                <span>Cambio</span>
                <strong>{formatCurrency(lastTicket.change)}</strong>
              </div>
            </div>
          </section>
        ) : null}

        <section className="module-card pos-sales-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Ventas recientes</h2>
              <p className="section-copy">{loading ? "Cargando..." : statusDetail}</p>
            </div>
          </div>

          {errorMessage ? <p className="form-message form-message-error">{errorMessage}</p> : null}
          {message ? <p className="form-message form-message-success">{message}</p> : null}

          {ventas.length > 0 ? (
            <div className="pos-sales-grid">
              {ventas.map((venta) => (
                <article key={venta.id} className="quote-card">
                  <div className="quote-card-head">
                    <div>
                      <h3 className="quote-card-title">{venta.folio}</h3>
                      <p className="quote-card-copy">{venta.cliente_nombre || "Venta mostrador"}</p>
                    </div>
                    <span className="status-chip status-chip-success">{labelForPaymentMethod(venta.payment_method)}</span>
                  </div>
                  <div className="quote-card-meta">
                    <div>
                      <span className="quotes-summary-label">Fecha</span>
                      <strong>{formatDate(venta.created_at)}</strong>
                    </div>
                    <div>
                      <span className="quotes-summary-label">Metodo</span>
                      <strong>{labelForPaymentMethod(venta.payment_method)}</strong>
                    </div>
                    <div>
                      <span className="quotes-summary-label">Total</span>
                      <strong>{formatCurrency(venta.total)}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>No hay ventas registradas todavia.</strong>
              <span>Cuando guardes una venta aparecera aqui.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function normalizeVenta(venta) {
  return {
    id: venta.id,
    folio: venta.folio || "Sin folio",
    cliente_nombre: venta.cliente_nombre || venta.client_name || "Venta mostrador",
    cash_session_id: venta.cash_session_id || null,
    payment_method: venta.payment_method || venta.metodo_pago || "efectivo",
    total: Number(venta.total || 0),
    created_at: venta.created_at || new Date().toISOString(),
  };
}

function buildPosErrorMessage(message) {
  const normalizedMessage = String(message || "");
  if (
    normalizedMessage.includes("column") ||
    normalizedMessage.includes("schema cache") ||
    normalizedMessage.includes("Could not find")
  ) {
    return `${POS_SCHEMA_HELP} Detalle: ${normalizedMessage}`;
  }

  return normalizedMessage || "No se pudo completar la operacion del mini POS.";
}

function buildSaleNumber(dateValue) {
  const issueDate = new Date(dateValue || Date.now());
  const year = issueDate.getFullYear();
  const stamp = issueDate.getTime().toString().slice(-6);
  return `VTA-${year}-${stamp}`;
}

function labelForPaymentMethod(value) {
  const labels = {
    efectivo: "Efectivo",
    transferencia: "Transferencia",
    tarjeta: "Tarjeta",
  };

  return labels[value] || "Sin metodo";
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

function buildTicketHtml(ticket) {
  const rows = (ticket.items || [])
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.producto_nombre || item.nombre || "-")}</td>
          <td>${item.cantidad || 0}</td>
          <td>${formatCurrency(item.precio_unitario || item.precio)}</td>
          <td>${formatCurrency(item.total)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <html>
      <head>
        <title>${escapeHtml(ticket.folio)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; }
          .ticket { max-width: 360px; margin: 0 auto; }
          .center { text-align: center; }
          .logo { width: 56px; height: 56px; border-radius: 14px; object-fit: cover; margin: 0 auto 10px; display: block; }
          h1 { font-size: 20px; margin: 0 0 6px; }
          p { margin: 4px 0; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin: 14px 0; }
          th, td { padding: 8px 4px; border-bottom: 1px dashed #cbd5e1; font-size: 12px; text-align: left; }
          .totals { margin-top: 12px; border-top: 1px solid #0f172a; padding-top: 10px; }
          .totals div { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px; }
          .totals strong { font-size: 16px; }
          .footer { margin-top: 16px; text-align: center; color: #64748b; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="ticket">
          <div class="center">
            ${ticket.logoUrl ? `<img src="${ticket.logoUrl}" alt="${escapeHtml(ticket.companyName)}" class="logo" />` : ""}
            <h1>${escapeHtml(ticket.companyName)}</h1>
            <p>${escapeHtml(ticket.companyPhone || "")}</p>
            <p>${escapeHtml(ticket.companyAddress || "")}</p>
            <p>${escapeHtml(ticket.companyEmail || "")}</p>
            <p><strong>${escapeHtml(ticket.folio)}</strong></p>
            <p>${escapeHtml(formatDate(ticket.created_at))}</p>
            <p>${escapeHtml(ticket.cliente_nombre || "Venta mostrador")}</p>
            <p>${escapeHtml(labelForPaymentMethod(ticket.payment_method))}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Articulo</th>
                <th>Cant.</th>
                <th>P.Unit</th>
                <th>Importe</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="totals">
            <div><span>Subtotal</span><span>${formatCurrency(ticket.subtotal)}</span></div>
            <div><span>IVA ${ticket.ivaRate}%</span><span>${formatCurrency(ticket.ivaAmount)}</span></div>
            <div><strong>Total</strong><strong>${formatCurrency(ticket.total)}</strong></div>
            <div><span>Recibido</span><span>${formatCurrency(ticket.amountReceived)}</span></div>
            <div><span>Cambio</span><span>${formatCurrency(ticket.change)}</span></div>
          </div>
          <div class="footer">Gracias por tu compra</div>
        </div>
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
