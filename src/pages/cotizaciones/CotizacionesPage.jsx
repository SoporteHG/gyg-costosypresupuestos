import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_IVA_RATE = 16;
const DEFAULT_VALIDITY_DAYS = 15;
const QUOTE_SELECT_FULL =
  "id, tenant_id, folio, cliente_id, cliente_nombre, cliente_empresa, cliente_rfc, cliente_email, cliente_telefono, cliente_direccion, cliente_condiciones_credito, cliente_centro_costos, vendedor_id, vendedor_nombre, vendedor_email, currency_code, estado, vigencia_dias, iva_rate, iva_amount, notas, items, subtotal, total, created_at";
const QUOTE_SELECT_LEGACY =
  "id, tenant_id, folio, cliente_id, cliente_nombre, cliente_empresa, cliente_rfc, cliente_email, cliente_telefono, cliente_direccion, cliente_condiciones_credito, cliente_centro_costos, currency_code, estado, vigencia_dias, iva_rate, iva_amount, notas, items, subtotal, total, created_at";

const initialItem = {
  id: crypto.randomUUID(),
  productoId: "",
  sku: "",
  nombre: "",
  unidad: "",
  cantidad: "1",
  precio: "0",
};

const initialForm = {
  clienteId: "",
  vendedorId: "",
  estado: "pendiente",
  vigenciaDias: String(DEFAULT_VALIDITY_DAYS),
  ivaRate: String(DEFAULT_IVA_RATE),
  currencyCode: "MXN",
  notas: "",
  items: [initialItem],
};

const STATUS_META = {
  pendiente: {
    label: "Pendiente de autorizacion",
    className: "status-chip status-chip-warning",
  },
  rechazada: {
    label: "No autorizada",
    className: "status-chip status-chip-danger",
  },
  autorizada: {
    label: "Autorizada y en proceso",
    className: "status-chip status-chip-success",
  },
};

export default function CotizacionesPage({ currentUser, companyId, company, branding }) {
  const [clientes, setClientes] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusDetail, setStatusDetail] = useState("Preparando carga...");

  useEffect(() => {
    loadCotizacionesModule();
  }, [currentUser?.id, companyId]);

  useEffect(() => {
    if (!selectedClient) {
      return;
    }

    const nextCurrency = selectedClient.centro_costos === "USD" ? "USD" : "MXN";
    setForm((previous) =>
      previous.currencyCode === nextCurrency
        ? previous
        : {
            ...previous,
            currencyCode: nextCurrency,
          }
    );
  }, [selectedClient]);

  const selectedClient = useMemo(
    () => clientes.find((cliente) => cliente.id === form.clienteId) || null,
    [clientes, form.clienteId]
  );

  const selectedSeller = useMemo(
    () => vendedores.find((vendedor) => vendedor.id === form.vendedorId) || null,
    [vendedores, form.vendedorId]
  );

  const totals = useMemo(() => {
    const subtotal = form.items.reduce((accumulator, item) => {
      const cantidad = Number(item.cantidad || 0);
      const precio = Number(item.precio || 0);
      return accumulator + cantidad * precio;
    }, 0);

    const ivaRate = Number(form.ivaRate || 0);
    const ivaAmount = subtotal * (ivaRate / 100);

    return {
      subtotal,
      ivaRate,
      ivaAmount,
      total: subtotal + ivaAmount,
    };
  }, [form.items, form.ivaRate]);

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
    setStatusDetail("Validando empresa activa...");

    if (!currentUser?.id || !companyId) {
      throw new Error("No se encontro la empresa activa del usuario.");
    }

    return companyId;
  }

  async function loadCotizacionesModule() {
    try {
      setLoading(true);
      setErrorMessage("");
      setMessage("");

      const tenantId = requireCompanyId();
      setStatusDetail("Cargando clientes y productos...");

      const [clientesResult, vendedoresResult, productosResult, cotizacionesResult] = await Promise.allSettled([
        withTimeout(
          supabase
            .from("clientes")
            .select("id, nombre, empresa, rfc, email, telefono, direccion, condiciones_credito, centro_costos")
            .eq("tenant_id", tenantId)
            .order("nombre", { ascending: true }),
          "consultar clientes"
        ),
        loadOptionalVendedores(tenantId),
        withTimeout(
          supabase
            .from("productos")
            .select("id, sku, nombre, unidad, categoria, precio")
            .eq("tenant_id", tenantId)
            .order("nombre", { ascending: true }),
          "consultar productos"
        ),
        loadCotizacionesWithFallback(tenantId),
      ]);

      if (clientesResult.status === "rejected") throw clientesResult.reason;
      if (productosResult.status === "rejected") throw productosResult.reason;

      const clientesResponse = clientesResult.value;
      const productosResponse = productosResult.value;

      if (clientesResponse.error) throw clientesResponse.error;
      if (productosResponse.error) throw productosResponse.error;

      setClientes(clientesResponse.data || []);
      setProductos(productosResponse.data || []);

      const vendedoresData =
        vendedoresResult.status === "fulfilled" ? vendedoresResult.value.data || [] : [];
      const vendedoresWarning =
        vendedoresResult.status === "fulfilled"
          ? vendedoresResult.value.warning || ""
          : vendedoresResult.reason?.message || "No se pudieron cargar los vendedores.";

      setVendedores(vendedoresData);

      const cotizacionesData =
        cotizacionesResult.status === "fulfilled" ? cotizacionesResult.value.data || [] : [];
      const cotizacionesWarning =
        cotizacionesResult.status === "fulfilled"
          ? cotizacionesResult.value.warning || ""
          : cotizacionesResult.reason?.message || "No se pudieron cargar las cotizaciones.";

      setCotizaciones(cotizacionesData);
      if (cotizacionesWarning || vendedoresWarning) {
        setErrorMessage(cotizacionesWarning || vendedoresWarning);
      }

      setStatusDetail(
        `Carga completa: ${cotizacionesData.length || 0} cotizacion(es), ${clientesResponse.data?.length || 0} cliente(s), ${vendedoresData.length || 0} vendedor(es), ${productosResponse.data?.length || 0} producto(s).`
      );
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo cargar el modulo de cotizaciones.");
      setStatusDetail("La carga se detuvo.");
    } finally {
      setLoading(false);
    }
  }

  function updateFormField(name, value) {
    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  function handleProductSelect(itemId, productoId) {
    const producto = productos.find((entry) => entry.id === productoId);

    setForm((previous) => ({
      ...previous,
      items: previous.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              productoId,
              sku: producto?.sku || "",
              nombre: producto?.nombre || "",
              unidad: producto?.unidad || "",
              precio: producto ? String(producto.precio ?? 0) : "0",
            }
          : item
      ),
    }));
  }

  function handleItemChange(itemId, field, value) {
    setForm((previous) => ({
      ...previous,
      items: previous.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              [field]: value,
            }
          : item
      ),
    }));
  }

  function addItemRow() {
    setForm((previous) => ({
      ...previous,
      items: [
        ...previous.items,
        {
          ...initialItem,
          id: crypto.randomUUID(),
        },
      ],
    }));
  }

  function removeItemRow(itemId) {
    setForm((previous) => {
      if (previous.items.length === 1) {
        return previous;
      }

      return {
        ...previous,
        items: previous.items.filter((item) => item.id !== itemId),
      };
    });
  }

  function resetForm() {
    setForm({
      ...initialForm,
      items: [
        {
          ...initialItem,
          id: crypto.randomUUID(),
        },
      ],
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Guardando cotizacion...");

      const tenantId = requireCompanyId();

      if (!form.clienteId) {
        throw new Error("Selecciona un cliente para la cotizacion.");
      }

      const normalizedItems = form.items
        .map((item) => ({
          producto_id: item.productoId || null,
          sku: item.sku || null,
          nombre: item.nombre || null,
          unidad: item.unidad || null,
          cantidad: Number(item.cantidad || 0),
          precio: Number(item.precio || 0),
          total: Number(item.cantidad || 0) * Number(item.precio || 0),
        }))
        .filter((item) => item.nombre && item.cantidad > 0);

      if (!normalizedItems.length) {
        throw new Error("Agrega al menos un producto valido a la cotizacion.");
      }

      const createdAt = new Date().toISOString();
      const folio = buildQuoteNumber(createdAt);
      const payload = {
        tenant_id: tenantId,
        folio,
        cliente_id: selectedClient?.id,
        cliente_nombre: selectedClient?.nombre || "",
        cliente_empresa: selectedClient?.empresa || null,
        cliente_rfc: selectedClient?.rfc || null,
        cliente_email: selectedClient?.email || null,
        cliente_telefono: selectedClient?.telefono || null,
        cliente_direccion: selectedClient?.direccion || null,
        cliente_condiciones_credito: selectedClient?.condiciones_credito || null,
        cliente_centro_costos: selectedClient?.centro_costos || "MXN",
        vendedor_id: selectedSeller?.id || null,
        vendedor_nombre: selectedSeller?.nombre || null,
        vendedor_email: selectedSeller?.email || null,
        currency_code: form.currencyCode === "USD" ? "USD" : "MXN",
        estado: form.estado,
        vigencia_dias: Number(form.vigenciaDias || 0),
        iva_rate: totals.ivaRate,
        iva_amount: totals.ivaAmount,
        notas: form.notas.trim() || null,
        items: normalizedItems,
        subtotal: totals.subtotal,
        total: totals.total,
        created_at: createdAt,
      };

      let response = await withTimeout(
        supabase.from("cotizaciones").insert(payload).select(QUOTE_SELECT_FULL).single(),
        "crear cotizacion"
      );

      if (response.error && isMissingSchemaError(response.error)) {
        const legacyPayload = { ...payload };
        delete legacyPayload.vendedor_id;
        delete legacyPayload.vendedor_nombre;
        delete legacyPayload.vendedor_email;

        response = await withTimeout(
          supabase.from("cotizaciones").insert(legacyPayload).select(QUOTE_SELECT_LEGACY).single(),
          "crear cotizacion"
        );

        if (!response.error && response.data) {
          response = {
            ...response,
            data: {
              ...response.data,
              vendedor_id: null,
              vendedor_nombre: null,
              vendedor_email: null,
            },
          };
        }
      }

      const { data, error } = response;

      if (error) throw error;

      setCotizaciones((previous) => [data, ...previous]);
      setMessage("Cotizacion creada correctamente.");
      setStatusDetail("Cotizacion guardada.");
      resetForm();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo guardar la cotizacion.");
      setStatusDetail("No se pudo completar el guardado.");
    } finally {
      setSaving(false);
    }
  }

  function handlePrint(cotizacion) {
    const printableWindow = window.open("", "_blank", "width=1200,height=900");
    if (!printableWindow) {
      setErrorMessage("El navegador bloqueo la ventana de impresion.");
      return;
    }
    printableWindow.document.write(
      buildPrintableHtml({
        cotizacion,
        company,
        branding,
        currentUser,
      })
    );

    printableWindow.document.close();
    printableWindow.focus();
    printableWindow.print();
  }

  function buildDraftQuote() {
    const createdAt = new Date().toISOString();
    const normalizedItems = form.items
      .map((item) => ({
        producto_id: item.productoId || null,
        sku: item.sku || null,
        nombre: item.nombre || null,
        unidad: item.unidad || null,
        cantidad: Number(item.cantidad || 0),
        precio: Number(item.precio || 0),
        total: Number(item.cantidad || 0) * Number(item.precio || 0),
      }))
      .filter((item) => item.nombre && item.cantidad > 0);

    return {
      folio: `BORRADOR-${buildQuoteNumber(createdAt).replace("COT-", "")}`,
      cliente_nombre: selectedClient?.nombre || "Cliente no seleccionado",
      cliente_empresa: selectedClient?.empresa || null,
      cliente_rfc: selectedClient?.rfc || null,
      cliente_email: selectedClient?.email || null,
      cliente_telefono: selectedClient?.telefono || null,
      cliente_direccion: selectedClient?.direccion || null,
      cliente_condiciones_credito: selectedClient?.condiciones_credito || null,
      cliente_centro_costos: selectedClient?.centro_costos || form.currencyCode,
      vendedor_id: selectedSeller?.id || null,
      vendedor_nombre: selectedSeller?.nombre || null,
      vendedor_email: selectedSeller?.email || null,
      currency_code: form.currencyCode === "USD" ? "USD" : "MXN",
      estado: form.estado,
      vigencia_dias: Number(form.vigenciaDias || 0),
      iva_rate: totals.ivaRate,
      iva_amount: totals.ivaAmount,
      notas: form.notas || "",
      items: normalizedItems,
      subtotal: totals.subtotal,
      total: totals.total,
      created_at: createdAt,
    };
  }

  async function handleDownloadPdf(cotizacion) {
    try {
      const pdf = new jsPDF({
        unit: "pt",
        format: "a4",
      });

      const brandName = branding?.business_name || company?.name || "Tu empresa";
      const brandLogo = branding?.logo_url || company?.logo_url || "";
      const brandColor = branding?.primary_color || company?.primary_color || "#1d4ed8";
      const accentColor = hexToRgb(brandColor);
      const companyEmail = branding?.email || currentUser?.email || "";
      const companyPhone = branding?.phone || "";
      const companyAddress = branding?.address || "";
      const companyRfc = branding?.rfc || "";
      const companyFooter = branding?.pdf_footer || "Documento generado desde el portal de costos y presupuestos.";
      const signatureUrl = branding?.signature_url || "";
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginX = 42;
      const contentWidth = pageWidth - marginX * 2;
      const issueDate = formatDate(cotizacion.created_at, false);
      const expiryDate = formatDate(calculateValidityDate(cotizacion.created_at, cotizacion.vigencia_dias), false);
      const tableWidth = 82 + 172 + 62 + 58 + 78 + 80;
      const panelWidth = Math.max(tableWidth, 520);
      const panelX = marginX + (contentWidth - panelWidth) / 2;
      const conditionsX = panelX + 286;
      const clientAddressLines = pdf.splitTextToSize(cotizacion.cliente_direccion || "Sin direccion registrada", 188);
      const notesValue = truncateSingleLine(cotizacion.notas || "Sin notas adicionales.", 34);
      const amountInWords = numberToSpanishWords(cotizacion.total, cotizacion.currency_code);

      pdf.setFillColor(246, 248, 252);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");
      pdf.setFillColor(accentColor.r, accentColor.g, accentColor.b);
      pdf.roundedRect(marginX, 32, contentWidth, 128, 22, 22, "F");

      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(marginX + 18, 50, 84, 84, 22, 22, "F");

      if (brandLogo) {
        try {
          const imageData = await getImageDataUrl(brandLogo);
          pdf.addImage(imageData, "PNG", marginX + 28, 60, 64, 64);
        } catch (error) {
          console.error("No se pudo cargar el logo para el PDF:", error);
        }
      } else {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(24);
        pdf.setTextColor(accentColor.r, accentColor.g, accentColor.b);
        pdf.text(brandName.slice(0, 2).toUpperCase(), marginX + 60, 102, { align: "center" });
      }

      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(24);
      pdf.text(brandName, marginX + 122, 82);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.text(companyEmail || "Sin correo", marginX + 122, 104);
      pdf.text(companyPhone || "Sin telefono", marginX + 122, 120);
      if (companyRfc) {
        pdf.text(`RFC ${companyRfc}`, marginX + 122, 136);
      }

      const folioBoxX = pageWidth - 198;
      const folioBoxY = 56;
      const folioBoxWidth = 138;
      const folioBoxHeight = 60;
      const folioCenterX = folioBoxX + folioBoxWidth / 2;

      pdf.setFillColor(239, 246, 255);
      pdf.roundedRect(folioBoxX, folioBoxY, folioBoxWidth, folioBoxHeight, 18, 18, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(accentColor.r, accentColor.g, accentColor.b);
      pdf.text("COTIZACION", folioCenterX, 74, { align: "center" });
      pdf.setTextColor(15, 23, 42);
      pdf.setFontSize(11);
      pdf.text(cotizacion.folio || "Sin folio", folioCenterX, 92, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(71, 85, 105);
      pdf.text(`Emision: ${issueDate}`, folioCenterX, 108, { align: "center" });

      pdf.setDrawColor(226, 232, 240);
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(panelX, 182, panelWidth, 132, 18, 18, "FD");
      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.text("Datos del cliente", panelX + 20, 206);
      pdf.text("Condiciones", conditionsX, 206);

      drawLabeledValue(pdf, "Cliente", cotizacion.cliente_nombre || "Cliente", panelX + 20, 232);
      drawLabeledValue(pdf, "Empresa", cotizacion.cliente_empresa || "Sin empresa", panelX + 20, 252);
      drawLabeledValue(pdf, "RFC", cotizacion.cliente_rfc || "Sin RFC", panelX + 20, 272);
      drawLabeledValue(pdf, "Telefono", cotizacion.cliente_telefono || "Sin telefono", panelX + 20, 292);

      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(15, 23, 42);
      pdf.text("Direccion", panelX + 20, 312);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(71, 85, 105);
      pdf.text(clientAddressLines, panelX + 88, 312);

      drawLabeledValue(pdf, "Estado", STATUS_META[cotizacion.estado]?.label || "Pendiente", conditionsX, 232);
      drawLabeledValue(
        pdf,
        "Vigencia",
        `${cotizacion.vigencia_dias || DEFAULT_VALIDITY_DAYS} dias`,
        conditionsX,
        252
      );
      drawLabeledValue(pdf, "Vence", expiryDate, conditionsX, 272);
      drawLabeledValue(pdf, "IVA", `${Number(cotizacion.iva_rate || 0)}%`, conditionsX, 292);

      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(15, 23, 42);
      pdf.text("Notas", conditionsX, 312);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(71, 85, 105);
      pdf.setFontSize(10);
      pdf.text(notesValue, conditionsX + 46, 312);

      autoTable(pdf, {
        startY: 340,
        head: [["SKU", "Concepto", "Unidad", "Cantidad", "Precio unit.", "Importe"]],
        body: (cotizacion.items || []).map((item) => [
          item.sku || "-",
          item.nombre || "-",
          item.unidad || "-",
          String(item.cantidad || 0),
          formatCurrency(item.precio, cotizacion.currency_code),
          formatCurrency(item.total, cotizacion.currency_code),
        ]),
        styles: {
          fontSize: 10,
          cellPadding: { top: 10, right: 8, bottom: 10, left: 8 },
          textColor: [30, 41, 59],
          valign: "middle",
        },
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: "bold",
        },
        columnStyles: {
          0: { cellWidth: 82 },
          1: { cellWidth: 172 },
          2: { cellWidth: 62 },
          3: { halign: "center", cellWidth: 58 },
          4: { halign: "right", cellWidth: 78 },
          5: { halign: "right", cellWidth: 80 },
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        margin: { left: marginX, right: marginX },
      });

      const tableY = pdf.lastAutoTable?.finalY || 340;
      const summaryWidth = 204;
      const summaryX = marginX + Math.max(0, tableWidth - summaryWidth);
      const summaryY = tableY + 24;
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(226, 232, 240);
      pdf.roundedRect(summaryX, summaryY, summaryWidth, 116, 18, 18, "FD");
      drawSummaryRow(
        pdf,
        "Subtotal",
        formatCurrency(cotizacion.subtotal, cotizacion.currency_code),
        summaryX + 18,
        summaryY + 28,
        false
      );
      drawSummaryRow(
        pdf,
        `IVA ${Number(cotizacion.iva_rate || 0)}%`,
        formatCurrency(cotizacion.iva_amount, cotizacion.currency_code),
        summaryX + 18,
        summaryY + 54,
        false
      );
      drawSummaryRow(
        pdf,
        "Total",
        formatCurrency(cotizacion.total, cotizacion.currency_code),
        summaryX + 18,
        summaryY + 86,
        true
      );

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(71, 85, 105);
      const amountLines = pdf.splitTextToSize(`Importe en letra: ${amountInWords}`, 188);
      pdf.text(amountLines, summaryX + 18, summaryY + 104);

      const signatureY = summaryY + 160;
      pdf.setDrawColor(203, 213, 225);
      pdf.line(marginX, signatureY, marginX + 180, signatureY);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(15, 23, 42);
      pdf.text("Firma / sello", marginX, signatureY + 18);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139);
      pdf.text(brandName, marginX, signatureY + 34);

      if (signatureUrl) {
        try {
          const signatureData = await getImageDataUrl(signatureUrl);
          pdf.addImage(signatureData, "PNG", marginX + 12, signatureY - 54, 120, 42);
        } catch (error) {
          console.error("No se pudo cargar la firma para el PDF:", error);
        }
      }

      const footerY = pageHeight - 52;
      pdf.setDrawColor(203, 213, 225);
      pdf.line(marginX, footerY - 14, pageWidth - marginX, footerY - 14);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      const footerLines = pdf.splitTextToSize(companyFooter, pageWidth - 220);
      pdf.text(footerLines, marginX, footerY);
      pdf.text(`Elaborado por ${brandName}`, pageWidth - marginX, footerY, { align: "right" });

      pdf.save(`${cotizacion.folio || "cotizacion"}.pdf`);
    } catch (error) {
      console.error(error);
      setErrorMessage("No se pudo generar el PDF de la cotizacion.");
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Cotizaciones</h1>
        <p>Crea cotizaciones a partir de tus clientes y productos activos, y da seguimiento por estado.</p>
      </div>

      <div className="quotes-layout">
        <section className="module-card quotes-form-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Nueva cotizacion</h2>
              <p className="section-copy">Selecciona cliente, agrega conceptos y deja el documento listo para imprimir o exportar a PDF.</p>
            </div>
          </div>

          <form className="quotes-form" onSubmit={handleSubmit}>
            <div className="quotes-top-grid quotes-top-grid-wide">
              <div className="form-group">
                <label>Cliente</label>
                <select
                  value={form.clienteId}
                  onChange={(event) => updateFormField("clienteId", event.target.value)}
                  className="quotes-select"
                  required
                >
                  <option value="">Selecciona un cliente</option>
                  {clientes.map((cliente) => (
                    <option key={cliente.id} value={cliente.id}>
                      {cliente.nombre}{cliente.empresa ? ` - ${cliente.empresa}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Vendedor</label>
                <select
                  value={form.vendedorId}
                  onChange={(event) => updateFormField("vendedorId", event.target.value)}
                  className="quotes-select"
                >
                  <option value="">Asignar despues</option>
                  {vendedores.map((vendedor) => (
                    <option key={vendedor.id} value={vendedor.id}>
                      {vendedor.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Estado</label>
                <select
                  value={form.estado}
                  onChange={(event) => updateFormField("estado", event.target.value)}
                  className="quotes-select"
                >
                  <option value="pendiente">Pendiente de autorizacion</option>
                  <option value="rechazada">No autorizada</option>
                  <option value="autorizada">Autorizada y en proceso</option>
                </select>
              </div>

              <div className="form-group quotes-number-field">
                <label>Vigencia (dias)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.vigenciaDias}
                  onChange={(event) => updateFormField("vigenciaDias", event.target.value)}
                />
              </div>

              <div className="form-group quotes-number-field">
                <label>IVA (%)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.ivaRate}
                  onChange={(event) => updateFormField("ivaRate", event.target.value)}
                />
              </div>

              <div className="form-group quotes-number-field">
                <label>Moneda</label>
                <input value={form.currencyCode} readOnly />
              </div>
            </div>

            <div className="quotes-client-summary quotes-client-summary-extended">
              <div>
                <span className="quotes-summary-label">Empresa</span>
                <strong>{selectedClient?.empresa || "Sin empresa"}</strong>
              </div>
              <div>
                <span className="quotes-summary-label">Moneda</span>
                <strong>{selectedClient?.centro_costos || form.currencyCode}</strong>
              </div>
              <div>
                <span className="quotes-summary-label">Correo</span>
                <strong>{selectedClient?.email || "Sin correo"}</strong>
              </div>
              <div>
                <span className="quotes-summary-label">Telefono</span>
                <strong>{selectedClient?.telefono || "Sin telefono"}</strong>
              </div>
              <div>
                <span className="quotes-summary-label">RFC</span>
                <strong>{selectedClient?.rfc || "Sin RFC"}</strong>
              </div>
              <div className="quotes-client-address">
                <span className="quotes-summary-label">Direccion</span>
                <strong>{selectedClient?.direccion || "Sin direccion"}</strong>
              </div>
              <div className="quotes-client-address">
                <span className="quotes-summary-label">Condiciones de credito</span>
                <strong>{selectedClient?.condiciones_credito || "Sin condiciones registradas"}</strong>
              </div>
              <div>
                <span className="quotes-summary-label">Vendedor</span>
                <strong>{selectedSeller?.nombre || "Sin asignar"}</strong>
              </div>
            </div>

            <div className="quotes-items-block">
              <div className="quotes-items-head">
                <div>
                  <h3 className="quotes-items-title">Conceptos</h3>
                  <p className="section-copy">Agrega productos desde tu catalogo y ajusta cantidad o precio si hace falta.</p>
                </div>
                <button type="button" className="secondary-btn" onClick={addItemRow}>
                  Agregar concepto
                </button>
              </div>

              <div className="quotes-items-list">
                {form.items.map((item, index) => (
                  <div key={item.id} className="quotes-item-row">
                    <div className="form-group">
                      <label>Producto #{index + 1}</label>
                      <select
                        value={item.productoId}
                        onChange={(event) => handleProductSelect(item.id, event.target.value)}
                        className="quotes-select"
                      >
                        <option value="">Selecciona un producto</option>
                        {productos.map((producto) => (
                          <option key={producto.id} value={producto.id}>
                            {producto.sku} - {producto.nombre}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>SKU</label>
                      <input value={item.sku} readOnly />
                    </div>

                    <div className="form-group">
                      <label>Unidad</label>
                      <input value={item.unidad} readOnly />
                    </div>

                    <div className="form-group quotes-number-field">
                      <label>Cantidad</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.cantidad}
                        onChange={(event) => handleItemChange(item.id, "cantidad", event.target.value)}
                      />
                    </div>

                    <div className="form-group quotes-number-field">
                      <label>Precio</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.precio}
                        onChange={(event) => handleItemChange(item.id, "precio", event.target.value)}
                      />
                    </div>

                    <div className="quotes-item-total">
                      <span>Total</span>
                      <strong>
                        {formatCurrency(
                          Number(item.cantidad || 0) * Number(item.precio || 0),
                          form.currencyCode
                        )}
                      </strong>
                    </div>

                    <button
                      type="button"
                      className="table-action-btn table-action-btn-danger"
                      onClick={() => removeItemRow(item.id)}
                      disabled={form.items.length === 1}
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group form-group-full">
              <label>Notas</label>
              <textarea
                value={form.notas}
                onChange={(event) => updateFormField("notas", event.target.value)}
                rows="3"
                placeholder="Condiciones comerciales, tiempos de entrega, aclaraciones..."
              />
            </div>

            <div className="quotes-summary-panel quotes-summary-panel-rich">
              <div>
                <span className="quotes-summary-label">Subtotal</span>
                <strong>{formatCurrency(totals.subtotal, form.currencyCode)}</strong>
              </div>
              <div>
                <span className="quotes-summary-label">IVA ({totals.ivaRate}%)</span>
                <strong>{formatCurrency(totals.ivaAmount, form.currencyCode)}</strong>
              </div>
              <div>
                <span className="quotes-summary-label">Total fiscal</span>
                <strong>{formatCurrency(totals.total, form.currencyCode)}</strong>
              </div>
            </div>

            <div className="settings-actions quotes-actions">
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? "Guardando..." : "Crear cotizacion"}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => handleDownloadPdf(buildDraftQuote())}
              >
                Descargar borrador PDF
              </button>
            </div>
          </form>
        </section>

        <section className="module-card quotes-list-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Cotizaciones creadas</h2>
              <p className="section-copy">
                {loading ? "Cargando cotizaciones..." : `${cotizaciones.length} cotizacion(es) registradas.`}
              </p>
              <p className="section-copy">{statusDetail}</p>
            </div>

            <button type="button" className="secondary-btn" onClick={loadCotizacionesModule} disabled={loading}>
              {loading ? "Actualizando..." : "Recargar"}
            </button>
          </div>

          {errorMessage ? <p className="form-message form-message-error">{errorMessage}</p> : null}
          {message ? <p className="form-message form-message-success">{message}</p> : null}

          {!loading && cotizaciones.length === 0 && !errorMessage ? (
            <div className="empty-state">
              <strong>No hay cotizaciones creadas todavia.</strong>
              <span>Usa el formulario superior para generar la primera.</span>
            </div>
          ) : null}

          {cotizaciones.length > 0 ? (
            <div className="quotes-cards-grid">
              {cotizaciones.map((cotizacion) => {
                const statusMeta = STATUS_META[cotizacion.estado] || STATUS_META.pendiente;

                return (
                  <article key={cotizacion.id} className="quote-card">
                    <div className="quote-card-head">
                      <div>
                        <h3 className="quote-card-title">{cotizacion.folio}</h3>
                        <p className="quote-card-copy">{cotizacion.cliente_nombre || "Cliente sin nombre"}</p>
                      </div>
                      <span className={statusMeta.className}>{statusMeta.label}</span>
                    </div>

                    <div className="quote-card-meta">
                      <div>
                        <span className="quotes-summary-label">Fecha</span>
                        <strong>{formatDate(cotizacion.created_at)}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Vigencia</span>
                        <strong>{cotizacion.vigencia_dias || DEFAULT_VALIDITY_DAYS} dias</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Total</span>
                        <strong>{formatCurrency(cotizacion.total, cotizacion.currency_code)}</strong>
                      </div>
                    </div>

                    <div className="quote-card-meta quote-card-meta-secondary">
                      <div>
                        <span className="quotes-summary-label">Subtotal</span>
                        <strong>{formatCurrency(cotizacion.subtotal, cotizacion.currency_code)}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">IVA</span>
                        <strong>{formatCurrency(cotizacion.iva_amount, cotizacion.currency_code)}</strong>
                      </div>
                      <div>
                        <span className="quotes-summary-label">Conceptos</span>
                        <strong>{cotizacion.items?.length || 0}</strong>
                      </div>
                    </div>

                    <p className="quote-card-notes">
                      Vendedor: {cotizacion.vendedor_nombre || "Sin asignar"} | Vigencia:{" "}
                      {cotizacion.vigencia_dias || DEFAULT_VALIDITY_DAYS} dias
                    </p>
                    <p className="quote-card-notes">
                      Moneda: {cotizacion.currency_code || "MXN"} | Credito:{" "}
                      {cotizacion.cliente_condiciones_credito || "Sin condiciones registradas."}
                    </p>
                    <p className="quote-card-notes">{cotizacion.notas || "Sin notas adicionales."}</p>

                    <div className="quote-card-actions">
                      <button type="button" className="primary-btn" onClick={() => handleDownloadPdf(cotizacion)}>
                        Descargar PDF
                      </button>
                      <button type="button" className="secondary-btn" onClick={() => handlePrint(cotizacion)}>
                        Imprimir / Exportar PDF
                      </button>
                    </div>
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

async function loadOptionalVendedores(tenantId) {
  const response = await withTimeout(
    supabase
      .from("vendedores")
      .select("id, nombre, email, telefono, comision, activo")
      .eq("tenant_id", tenantId)
      .eq("activo", true)
      .order("nombre", { ascending: true }),
    "consultar vendedores"
  );

  if (response.error) {
    return {
      data: [],
      warning: isMissingSchemaError(response.error)
        ? "El modulo de vendedores aun no esta configurado en Supabase."
        : response.error.message || "No se pudieron cargar los vendedores.",
    };
  }

  return {
    data: response.data || [],
    warning: "",
  };
}

async function loadCotizacionesWithFallback(tenantId) {
  const fullResponse = await withTimeout(
    supabase.from("cotizaciones").select(QUOTE_SELECT_FULL).eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    "consultar cotizaciones"
  );

  if (!fullResponse.error) {
    return {
      data: fullResponse.data || [],
      warning: "",
    };
  }

  const legacyResponse = await withTimeout(
    supabase.from("cotizaciones").select(QUOTE_SELECT_LEGACY).eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    "consultar cotizaciones"
  );

  if (legacyResponse.error) {
    return {
      data: [],
      warning: legacyResponse.error.message || fullResponse.error.message || "No se pudieron cargar las cotizaciones.",
    };
  }

  return {
    data: (legacyResponse.data || []).map((quote) => ({
      ...quote,
      vendedor_id: null,
      vendedor_nombre: null,
      vendedor_email: null,
    })),
    warning: isMissingSchemaError(fullResponse.error)
      ? "Corre el SQL de vendedores en Supabase para habilitar la asignacion comercial."
      : fullResponse.error.message || "",
  };
}

function buildQuoteNumber(dateValue) {
  const issueDate = new Date(dateValue || Date.now());
  const year = issueDate.getFullYear();
  const stamp = issueDate.getTime().toString().slice(-6);
  return `COT-${year}-${stamp}`;
}

function calculateValidityDate(createdAt, validityDays) {
  const baseDate = new Date(createdAt || Date.now());
  const safeDays = Number(validityDays || DEFAULT_VALIDITY_DAYS);
  baseDate.setDate(baseDate.getDate() + safeDays);
  return baseDate;
}

function buildPrintableHtml({ cotizacion, company, branding, currentUser }) {
  const brandName = branding?.business_name || company?.name || "Tu empresa";
  const brandLogo = branding?.logo_url || company?.logo_url || "";
  const brandColor = branding?.primary_color || company?.primary_color || "#1d4ed8";
  const companyEmail = branding?.email || currentUser?.email || "";
  const companyPhone = branding?.phone || "";
  const companyAddress = branding?.address || "";
  const companyRfc = branding?.rfc || "";
  const companyFooter =
    branding?.pdf_footer || "Esta cotizacion fue generada desde el portal de costos y presupuestos.";
  const validityDate = formatDate(calculateValidityDate(cotizacion.created_at, cotizacion.vigencia_dias), false);
  const amountInWords = numberToSpanishWords(cotizacion.total, cotizacion.currency_code);
  const itemsRows = (cotizacion.items || [])
    .map(
      (item) => `
          <tr>
            <td>${escapeHtml(item.sku || "-")}</td>
            <td>${escapeHtml(item.nombre || "-")}</td>
            <td>${escapeHtml(item.unidad || "-")}</td>
            <td>${item.cantidad || 0}</td>
            <td>${formatCurrency(item.precio, cotizacion.currency_code)}</td>
            <td>${formatCurrency(item.total, cotizacion.currency_code)}</td>
          </tr>
        `
    )
    .join("");

  return `
    <html>
      <head>
        <title>${escapeHtml(cotizacion.folio || "Cotizacion")}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 34px; color: #0f172a; background: #f8fafc; }
          .sheet { background: #fff; border-radius: 24px; overflow: hidden; max-width: 820px; margin: 0 auto; }
          .hero { background: ${brandColor}; color: #fff; padding: 28px 34px; display: flex; justify-content: space-between; gap: 20px; }
          .hero-brand { display: flex; gap: 18px; align-items: center; }
          .hero-logo { width: 78px; height: 78px; border-radius: 20px; background: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; color: ${brandColor}; font-weight: 800; }
          .hero-logo img { width: 100%; height: 100%; object-fit: cover; }
          .hero h1 { margin: 0 0 8px; font-size: 30px; }
          .hero p { margin: 3px 0; opacity: 0.92; }
          .folio { background: #fff; color: #0f172a; border-radius: 20px; padding: 14px 16px; min-width: 164px; text-align: center; }
          .folio strong { display: block; font-size: 15px; margin-top: 6px; line-height: 1.3; }
          .folio .label { font-size: 11px; }
          .folio .value { font-size: 11px; }
          .body { padding: 28px 34px 34px; }
          .summary-grid { display: grid; grid-template-columns: 1.08fr 0.84fr; gap: 12px; margin: 0 auto 20px; max-width: 760px; }
          .panel { border: 1px solid #e2e8f0; border-radius: 18px; padding: 15px; }
          .panel h3 { margin: 0 0 10px; font-size: 16px; }
          .row { margin-bottom: 7px; }
          .label { color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em; }
          .value { color: #0f172a; font-size: 12px; font-weight: 600; }
          .panel-conditions .value { font-size: 11px; }
          .panel-conditions { padding-left: 13px; padding-right: 13px; }
          .panel-conditions .row:last-child .value { white-space: nowrap; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th, td { padding: 11px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; font-size: 13px; }
          th { background: #0f172a; color: #fff; font-size: 12px; }
          .totals { width: 304px; margin: 20px 48px 0 auto; border: 1px solid #e2e8f0; border-radius: 18px; padding: 16px 18px; }
          .totals-row { display: grid; grid-template-columns: 1fr auto; gap: 18px; margin-bottom: 12px; align-items: center; }
          .totals-row span:first-child { color: #475569; }
          .totals-row strong { min-width: 120px; text-align: right; display: inline-block; }
          .totals-row:last-child { margin-bottom: 0; font-size: 18px; font-weight: 800; }
          .amount-words { margin-top: 12px; color: #475569; font-size: 12px; line-height: 1.5; }
          .signature { margin-top: 52px; width: 220px; border-top: 1px solid #94a3b8; padding-top: 10px; }
          .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 11px; display: flex; justify-content: space-between; gap: 18px; }
          .footer-copy { max-width: 70%; }
          .footer-author { text-align: right; white-space: nowrap; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="hero">
            <div class="hero-brand">
              <div class="hero-logo">
                ${brandLogo ? `<img src="${brandLogo}" alt="${escapeHtml(brandName)}" />` : escapeHtml(brandName.slice(0, 2).toUpperCase())}
              </div>
              <div>
                <h1>${escapeHtml(brandName)}</h1>
                <p>${escapeHtml(companyEmail || "Sin correo")}</p>
                <p>${escapeHtml(companyPhone || "Sin telefono")}</p>
                <p>${escapeHtml(companyAddress || "Sin direccion")}</p>
                <p>${escapeHtml(companyRfc ? `RFC ${companyRfc}` : "")}</p>
              </div>
            </div>
            <div class="folio">
              <div class="label">Cotizacion</div>
              <strong>${escapeHtml(cotizacion.folio || "Sin folio")}</strong>
              <div class="row"><span class="label">Emision</span><div class="value">${escapeHtml(formatDate(cotizacion.created_at, false))}</div></div>
            </div>
          </div>
          <div class="body">
            <div class="summary-grid">
              <div class="panel panel-client">
                <h3>Cliente</h3>
                <div class="row"><div class="label">Nombre</div><div class="value">${escapeHtml(cotizacion.cliente_nombre || "Cliente")}</div></div>
                <div class="row"><div class="label">Empresa</div><div class="value">${escapeHtml(cotizacion.cliente_empresa || "Sin empresa")}</div></div>
                <div class="row"><div class="label">RFC</div><div class="value">${escapeHtml(cotizacion.cliente_rfc || "Sin RFC")}</div></div>
                <div class="row"><div class="label">Telefono</div><div class="value">${escapeHtml(cotizacion.cliente_telefono || "Sin telefono")}</div></div>
                <div class="row"><div class="label">Direccion</div><div class="value">${escapeHtml(cotizacion.cliente_direccion || "Sin direccion")}</div></div>
              </div>
              <div class="panel panel-conditions">
                <h3>Condiciones</h3>
                <div class="row"><div class="label">Estado</div><div class="value">${escapeHtml(STATUS_META[cotizacion.estado]?.label || "Pendiente")}</div></div>
                <div class="row"><div class="label">Vigencia</div><div class="value">${escapeHtml(`${cotizacion.vigencia_dias || DEFAULT_VALIDITY_DAYS} dias`)}</div></div>
                <div class="row"><div class="label">Vence</div><div class="value">${escapeHtml(validityDate)}</div></div>
                <div class="row"><div class="label">IVA</div><div class="value">${escapeHtml(`${Number(cotizacion.iva_rate || 0)}%`)}</div></div>
                <div class="row"><div class="label">Moneda</div><div class="value">${escapeHtml(cotizacion.currency_code || "MXN")}</div></div>
                <div class="row"><div class="label">Vendedor</div><div class="value">${escapeHtml(cotizacion.vendedor_nombre || "Sin asignar")}</div></div>
                <div class="row"><div class="label">Credito</div><div class="value">${escapeHtml(cotizacion.cliente_condiciones_credito || "Sin condiciones registradas.")}</div></div>
                <div class="row"><div class="label">Notas</div><div class="value">${escapeHtml(cotizacion.notas || "Sin notas adicionales.")}</div></div>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Concepto</th>
                  <th>Unidad</th>
                  <th>Cantidad</th>
                  <th>Precio unit.</th>
                  <th>Importe</th>
                </tr>
              </thead>
              <tbody>${itemsRows}</tbody>
            </table>
            <div class="totals">
              <div class="totals-row"><span>Subtotal</span><strong>${formatCurrency(cotizacion.subtotal, cotizacion.currency_code)}</strong></div>
              <div class="totals-row"><span>IVA ${Number(cotizacion.iva_rate || 0)}%</span><strong>${formatCurrency(cotizacion.iva_amount, cotizacion.currency_code)}</strong></div>
              <div class="totals-row"><span>Total</span><strong>${formatCurrency(cotizacion.total, cotizacion.currency_code)}</strong></div>
              <div class="amount-words">Importe en letra: ${escapeHtml(amountInWords)}</div>
            </div>
            <div class="signature">
              <div class="label">Firma / sello</div>
              <div class="value">${escapeHtml(brandName)}</div>
            </div>
            <div class="footer">
              <div class="footer-copy">${escapeHtml(companyFooter)}</div>
              <div class="footer-author">Elaborado por ${escapeHtml(brandName)}</div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

function drawSummaryRow(pdf, label, value, x, y, emphasize) {
  pdf.setFont("helvetica", emphasize ? "bold" : "normal");
  pdf.setFontSize(emphasize ? 14 : 11);
  pdf.setTextColor(emphasize ? 15 : 100, emphasize ? 23 : 116, emphasize ? 42 : 139);
  pdf.text(label, x, y);
  pdf.text(value, x + 168, y, { align: "right" });
}

function numberToSpanishWords(value, currencyCode = "MXN") {
  const amount = Number(value || 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const integerPart = Math.floor(safeAmount);
  const cents = Math.round((safeAmount - integerPart) * 100);
  const centsText = String(cents).padStart(2, "0");
  const suffix =
    currencyCode === "USD" ? `dolares ${centsText}/100 USD` : `pesos ${centsText}/100 M.N.`;
  return `${convertNumberToWords(integerPart)} ${suffix}`.replace(/^./, (letter) => letter.toUpperCase());
}

function convertNumberToWords(value) {
  const number = Math.floor(Number(value || 0));
  if (number === 0) return "cero";
  if (number < 0) return `menos ${convertNumberToWords(Math.abs(number))}`;

  const units = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
  const teens = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciseis", "diecisiete", "dieciocho", "diecinueve"];
  const tens = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const hundreds = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

  function convertBelowHundred(n) {
    if (n < 10) return units[n];
    if (n < 20) return teens[n - 10];
    if (n < 30) return n === 20 ? "veinte" : `veinti${units[n - 20]}`;
    const ten = Math.floor(n / 10);
    const unit = n % 10;
    return unit === 0 ? tens[ten] : `${tens[ten]} y ${units[unit]}`;
  }

  function convertBelowThousand(n) {
    if (n === 100) return "cien";
    if (n < 100) return convertBelowHundred(n);
    const hundred = Math.floor(n / 100);
    const remainder = n % 100;
    return remainder === 0 ? hundreds[hundred] : `${hundreds[hundred]} ${convertBelowHundred(remainder)}`;
  }

  if (number < 1000) return convertBelowThousand(number);
  if (number < 1000000) {
    const thousands = Math.floor(number / 1000);
    const remainder = number % 1000;
    const thousandsText = thousands === 1 ? "mil" : `${convertBelowThousand(thousands)} mil`;
    return remainder === 0 ? thousandsText : `${thousandsText} ${convertBelowThousand(remainder)}`;
  }

  const millions = Math.floor(number / 1000000);
  const remainder = number % 1000000;
  const millionsText = millions === 1 ? "un millon" : `${convertNumberToWords(millions)} millones`;
  return remainder === 0 ? millionsText : `${millionsText} ${convertNumberToWords(remainder)}`;
}

function truncateSingleLine(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function formatCurrency(value, currencyCode = "MXN") {
  const amount = Number(value || 0);
  const safeCurrency = currencyCode === "USD" ? "USD" : "MXN";
  const locale = safeCurrency === "USD" ? "en-US" : "es-MX";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: safeCurrency,
  }).format(amount);
}

function formatDate(value, includeTime = true) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat(
    "es-MX",
    includeTime
      ? {
          dateStyle: "medium",
          timeStyle: "short",
        }
      : {
          dateStyle: "medium",
        }
  ).format(new Date(value));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hexToRgb(hex) {
  const normalized = String(hex || "#1d4ed8").replace("#", "");
  const safeHex = normalized.length === 3
    ? normalized
        .split("")
        .map((value) => value + value)
        .join("")
    : normalized.padEnd(6, "0").slice(0, 6);

  const parsed = Number.parseInt(safeHex, 16);

  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function getImageDataUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("No se pudo preparar el logo."));
        return;
      }
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("No se pudo cargar la imagen."));
    image.src = url;
  });
}

function drawLabeledValue(pdf, label, value, x, y) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(15, 23, 42);
  pdf.text(label, x, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(71, 85, 105);
  pdf.text(String(value || "-"), x + 58, y);
}

function isMissingSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("schema cache") ||
    message.includes("vendedores") ||
    message.includes("vendedor_")
  );
}
