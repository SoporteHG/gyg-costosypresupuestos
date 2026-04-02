import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_IVA_RATE = 16;
const DEFAULT_VALIDITY_DAYS = 15;

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
  const [productos, setProductos] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusDetail, setStatusDetail] = useState("Preparando carga...");

  const selectedClient = useMemo(
    () => clientes.find((cliente) => cliente.id === form.clienteId) || null,
    [clientes, form.clienteId]
  );

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

      const [clientesResult, productosResult, cotizacionesResult] = await Promise.allSettled([
        withTimeout(
          supabase
            .from("clientes")
            .select("id, nombre, empresa, rfc, email, telefono, direccion, condiciones_credito, centro_costos, tiene_vendedor, vendedor_nombre")
            .eq("tenant_id", tenantId)
            .order("nombre", { ascending: true }),
          "consultar clientes"
        ),
        withTimeout(
          supabase
            .from("productos")
            .select("id, sku, nombre, unidad, categoria, precio")
            .eq("tenant_id", tenantId)
            .order("nombre", { ascending: true }),
          "consultar productos"
        ),
        withTimeout(
          supabase
            .from("cotizaciones")
            .select(
              "id, tenant_id, folio, cliente_id, cliente_nombre, cliente_empresa, cliente_rfc, cliente_email, cliente_telefono, cliente_direccion, cliente_condiciones_credito, cliente_centro_costos, currency_code, estado, vigencia_dias, iva_rate, iva_amount, notas, items, subtotal, total, created_at"
            )
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: false }),
          "consultar cotizaciones"
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

      let cotizacionesData = [];
      let cotizacionesWarning = "";

      if (cotizacionesResult.status === "fulfilled") {
        if (cotizacionesResult.value.error) {
          cotizacionesWarning = cotizacionesResult.value.error.message || "No se pudieron cargar las cotizaciones.";
        } else {
          cotizacionesData = cotizacionesResult.value.data || [];
        }
      } else {
        cotizacionesWarning = cotizacionesResult.reason?.message || "No se pudieron cargar las cotizaciones.";
      }

      setCotizaciones(cotizacionesData);
      if (cotizacionesWarning) {
        setErrorMessage(cotizacionesWarning);
      }

      setStatusDetail(
        `Carga completa: ${cotizacionesData.length || 0} cotizacion(es), ${clientesResponse.data?.length || 0} cliente(s), ${productosResponse.data?.length || 0} producto(s).`
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
        vendedor_nombre: selectedClient?.tiene_vendedor ? selectedClient?.vendedor_nombre || null : null,
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

      const { data, error } = await withTimeout(
        supabase
          .from("cotizaciones")
          .insert(payload)
          .select(
            "id, tenant_id, folio, cliente_id, cliente_nombre, cliente_empresa, cliente_rfc, cliente_email, cliente_telefono, cliente_direccion, cliente_condiciones_credito, cliente_centro_costos, vendedor_nombre, currency_code, estado, vigencia_dias, iva_rate, iva_amount, notas, items, subtotal, total, created_at"
          )
          .single(),
        "crear cotizacion"
      );

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
      vendedor_nombre: selectedClient?.tiene_vendedor ? selectedClient?.vendedor_nombre || null : null,
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
      const marginX = 38;
      const contentWidth = pageWidth - marginX * 2;
      const issueDate = formatDate(cotizacion.created_at, false);
      const expiryDate = formatDate(calculateValidityDate(cotizacion.created_at, cotizacion.vigencia_dias), false);
      const infoLabelWidth = 68;
      const amountInWords = numberToSpanishWords(cotizacion.total, cotizacion.currency_code);
      const topY = 38;

      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");
      pdf.setDrawColor(226, 232, 240);
      pdf.line(marginX, topY + 72, pageWidth - marginX, topY + 72);

      const logoBox = {
        x: marginX,
        y: topY,
        width: 156,
        height: 82,
      };

      if (brandLogo) {
        try {
          const imageAsset = await getImageDataUrl(brandLogo);
          const logoSize = fitImageIntoBox(
            imageAsset.width,
            imageAsset.height,
            logoBox.width - 4,
            logoBox.height - 4
          );
          const logoX = logoBox.x + (logoBox.width - logoSize.width) / 2;
          const logoY = logoBox.y + (logoBox.height - logoSize.height) / 2;
          pdf.addImage(imageAsset.dataUrl, "PNG", logoX, logoY, logoSize.width, logoSize.height);
        } catch (error) {
          console.error("No se pudo cargar el logo para el PDF:", error);
        }
      } else {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(18);
        pdf.setTextColor(accentColor.r, accentColor.g, accentColor.b);
        pdf.text(brandName.slice(0, 2).toUpperCase(), logoBox.x + logoBox.width / 2, topY + 35, {
          align: "center",
        });
      }

      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(17);
      pdf.text(brandName, marginX + 164, topY + 20);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
      pdf.setTextColor(71, 85, 105);
      pdf.text(companyEmail || "Sin correo", marginX + 164, topY + 38);
      pdf.text(companyPhone || "Sin telefono", marginX + 164, topY + 52);
      if (companyRfc) {
        pdf.text(`RFC ${companyRfc}`, marginX + 164, topY + 66);
      }

      const folioBoxWidth = 160;
      const folioBoxX = pageWidth - marginX - folioBoxWidth;
      pdf.setFillColor(accentColor.r, accentColor.g, accentColor.b);
      pdf.rect(folioBoxX, topY, folioBoxWidth, 22, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.text("COTIZACION", folioBoxX + folioBoxWidth / 2, topY + 15, { align: "center" });
      pdf.setDrawColor(226, 232, 240);
      pdf.rect(folioBoxX, topY + 22, folioBoxWidth, 42);
      pdf.setTextColor(15, 23, 42);
      pdf.setFontSize(12);
      pdf.text(cotizacion.folio || "Sin folio", folioBoxX + 10, topY + 40);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(71, 85, 105);
      pdf.text(issueDate, folioBoxX + 10, topY + 56);

      const detailsTop = topY + 92;
      const leftColX = marginX;
      const rightColX = marginX + 300;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.setTextColor(15, 23, 42);
      pdf.text("Cliente", leftColX, detailsTop);
      pdf.text("Empresa", leftColX, detailsTop + 18);
      pdf.text("RFC", leftColX, detailsTop + 36);
      pdf.text("Moneda", rightColX, detailsTop);
      pdf.text("Fecha", rightColX, detailsTop + 18);
      pdf.text("Estado", rightColX, detailsTop + 36);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.2);
      pdf.setTextColor(51, 65, 85);
      pdf.text(String(cotizacion.cliente_nombre || "Cliente"), leftColX + infoLabelWidth, detailsTop);
      pdf.text(String(cotizacion.cliente_empresa || "Sin empresa"), leftColX + infoLabelWidth, detailsTop + 18);
      pdf.text(String(cotizacion.cliente_rfc || "Sin RFC"), leftColX + infoLabelWidth, detailsTop + 36);
      pdf.text(String(cotizacion.currency_code || "MXN"), rightColX + 54, detailsTop);
      pdf.text(issueDate, rightColX + 54, detailsTop + 18);
      pdf.text(STATUS_META[cotizacion.estado]?.label || "Pendiente", rightColX + 54, detailsTop + 36);

      const boxTop = topY + 164;
      const boxGap = 8;
      const boxWidth = (contentWidth - boxGap * 3) / 4;
      const boxHeaderHeight = 20;
      const boxBodyHeight = 28;
      const boxData = [
        { title: "Credito", value: cotizacion.cliente_condiciones_credito || "Sin condiciones" },
        { title: "Vigencia", value: `${cotizacion.vigencia_dias || DEFAULT_VALIDITY_DAYS} dias` },
        { title: "Moneda", value: cotizacion.currency_code || "MXN" },
        { title: "Vendedor", value: cotizacion.vendedor_nombre || "Sin vendedor" },
      ];

      boxData.forEach((box, index) => {
        const x = marginX + index * (boxWidth + boxGap);
        pdf.setFillColor(accentColor.r, accentColor.g, accentColor.b);
        pdf.rect(x, boxTop, boxWidth, boxHeaderHeight, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8.5);
        pdf.text(box.title, x + boxWidth / 2, boxTop + 15, { align: "center" });
        pdf.setDrawColor(203, 213, 225);
        pdf.setFillColor(255, 255, 255);
        pdf.rect(x, boxTop + boxHeaderHeight, boxWidth, boxBodyHeight, "FD");
        pdf.setTextColor(15, 23, 42);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.8);
        pdf.text(truncateSingleLine(box.value, 24), x + 7, boxTop + boxHeaderHeight + 18);
      });

      autoTable(pdf, {
        startY: boxTop + boxHeaderHeight + boxBodyHeight + 18,
        head: [["Articulo", "Nombre", "U. med.", "Unidades", "Precio", "Importe"]],
        body: (cotizacion.items || []).map((item) => [
          item.sku || "-",
          item.nombre || "-",
          item.unidad || "-",
          String(item.cantidad || 0),
          formatCurrency(item.precio, cotizacion.currency_code),
          formatCurrency(item.total, cotizacion.currency_code),
        ]),
        styles: {
          fontSize: 9,
          lineColor: [226, 232, 240],
          lineWidth: 0.6,
          cellPadding: { top: 7, right: 6, bottom: 7, left: 6 },
          textColor: [30, 41, 59],
          valign: "middle",
        },
        headStyles: {
          fillColor: [accentColor.r, accentColor.g, accentColor.b],
          textColor: [255, 255, 255],
          fontStyle: "bold",
        },
        columnStyles: {
          0: { cellWidth: 72 },
          1: { cellWidth: 186 },
          2: { cellWidth: 56 },
          3: { halign: "center", cellWidth: 60 },
          4: { halign: "right", cellWidth: 72 },
          5: { halign: "right", cellWidth: 72 },
        },
        margin: { left: marginX, right: marginX },
      });

      const tableY = pdf.lastAutoTable?.finalY || boxTop + 120;
      const summaryWidth = 196;
      const summaryX = pageWidth - marginX - summaryWidth + 18;
      const summaryY = tableY + 18;
      drawSummaryRow(
        pdf,
        "Subtotal",
        formatCurrency(cotizacion.subtotal, cotizacion.currency_code),
        summaryX + 16,
        summaryY + 22,
        false
      );
      drawSummaryRow(
        pdf,
        `IVA ${Number(cotizacion.iva_rate || 0)}%`,
        formatCurrency(cotizacion.iva_amount, cotizacion.currency_code),
        summaryX + 16,
        summaryY + 42,
        false
      );
      drawSummaryRow(
        pdf,
        "Total",
        formatCurrency(cotizacion.total, cotizacion.currency_code),
        summaryX + 16,
        summaryY + 66,
        true
      );

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(71, 85, 105);
      const amountLines = pdf.splitTextToSize(`Importe en letra: ${amountInWords}`, contentWidth - 12);
      pdf.text(amountLines, marginX, summaryY + 110);

      const signatureY = summaryY + 158;
      pdf.setDrawColor(203, 213, 225);
      pdf.line(marginX, signatureY, marginX + 180, signatureY);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(15, 23, 42);
      pdf.text("Firma / sello", marginX, signatureY + 15);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(brandName, marginX, signatureY + 29);

      if (signatureUrl) {
        try {
          const signatureData = await getImageDataUrl(signatureUrl);
          pdf.addImage(signatureData.dataUrl, "PNG", marginX + 8, signatureY - 48, 110, 38);
        } catch (error) {
          console.error("No se pudo cargar la firma para el PDF:", error);
        }
      }

      const footerY = pageHeight - 52;
      pdf.setDrawColor(203, 213, 225);
      pdf.line(marginX, footerY - 14, pageWidth - marginX, footerY - 14);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
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
                <strong>
                  {selectedClient?.tiene_vendedor
                    ? selectedClient?.vendedor_nombre || "Asignado"
                    : "Sin vendedor"}
                </strong>
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
                      Vendedor: {cotizacion.vendedor_nombre || "Sin vendedor"}
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
          body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; padding: 28px; color: #0f172a; background: #ffffff; }
          .sheet { background: #fff; max-width: 920px; margin: 0 auto; }
          .hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; padding-bottom: 14px; border-bottom: 1px solid #cbd5e1; }
          .hero-brand { display: flex; gap: 16px; align-items: flex-start; }
          .hero-logo { width: 138px; height: 76px; padding: 4px; background: #fff; border: 1px solid #dbe3ef; display: flex; align-items: center; justify-content: center; overflow: hidden; color: ${brandColor}; font-weight: 800; box-sizing: border-box; }
          .hero-logo img { width: 100%; height: 100%; object-fit: contain; object-position: center; }
          .hero h1 { margin: 0 0 6px; font-size: 20px; color: #0f172a; }
          .hero p { margin: 2px 0; color: #475569; font-size: 10px; }
          .folio { min-width: 170px; }
          .folio-top { background: ${brandColor}; color: #fff; font-weight: 700; text-align: center; font-size: 11px; padding: 6px 10px; }
          .folio-body { border: 1px solid #cbd5e1; border-top: none; padding: 10px 12px; }
          .folio-body strong { display: block; font-size: 14px; margin-bottom: 5px; }
          .folio-body div { font-size: 10px; color: #475569; }
          .body { padding-top: 16px; }
          .client-grid { display: grid; grid-template-columns: 1.08fr 0.92fr; gap: 24px; margin-bottom: 18px; }
          .client-col { display: grid; gap: 10px; }
          .line { display: grid; grid-template-columns: 68px 1fr; gap: 12px; align-items: start; }
          .label { color: #0f172a; font-size: 10px; font-weight: 700; text-transform: uppercase; }
          .value { color: #334155; font-size: 11px; line-height: 1.35; }
          .meta-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
          .meta-card { min-width: 0; }
          .meta-head { background: ${brandColor}; color: #fff; font-size: 11px; font-weight: 700; text-align: center; padding: 5px 8px; }
          .meta-body { border: 1px solid #cbd5e1; border-top: none; padding: 8px 10px; font-size: 10px; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          table { width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
          col.col-articulo { width: 14%; }
          col.col-nombre { width: 43%; }
          col.col-unidad { width: 12%; }
          col.col-cantidad { width: 13%; }
          col.col-precio { width: 9%; }
          col.col-importe { width: 9%; }
          th, td { padding: 7px 7px; border: 1px solid #dbe3ef; text-align: left; font-size: 10.5px; }
          th { background: ${brandColor}; color: #fff; font-size: 10px; }
          td { word-wrap: break-word; }
          td:nth-child(4), td:nth-child(5), td:nth-child(6), th:nth-child(4), th:nth-child(5), th:nth-child(6) { text-align: right; }
          .totals { width: 220px; margin: 18px -18px 0 auto; padding: 0; }
          .totals-row { display: grid; grid-template-columns: 1fr auto; gap: 14px; padding: 5px 0; align-items: center; }
          .totals-row span:first-child { color: #64748b; font-size: 10px; }
          .totals-row strong { min-width: 116px; text-align: right; display: inline-block; font-size: 10px; color: #334155; }
          .totals-row.total { border-top: 1px solid #cbd5e1; margin-top: 6px; padding-top: 9px; font-size: 14px; font-weight: 800; }
          .totals-row.total strong { font-size: 14px; color: #0f172a; }
          .amount-words { margin-top: 8px; color: #64748b; font-size: 9px; line-height: 1.35; }
          .signature { margin-top: 44px; width: 220px; border-top: 1px solid #94a3b8; padding-top: 8px; }
          .footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 9px; display: flex; justify-content: space-between; gap: 18px; }
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
              <div class="folio-top">COTIZACION</div>
              <div class="folio-body">
                <strong>${escapeHtml(cotizacion.folio || "Sin folio")}</strong>
                <div>${escapeHtml(formatDate(cotizacion.created_at, false))}</div>
              </div>
            </div>
          </div>
          <div class="body">
            <div class="client-grid">
              <div class="client-col">
                <div class="line"><div class="label">Cliente</div><div class="value">${escapeHtml(cotizacion.cliente_nombre || "Cliente")}</div></div>
                <div class="line"><div class="label">Empresa</div><div class="value">${escapeHtml(cotizacion.cliente_empresa || "Sin empresa")}</div></div>
                <div class="line"><div class="label">RFC</div><div class="value">${escapeHtml(cotizacion.cliente_rfc || "Sin RFC")}</div></div>
              </div>
              <div class="client-col">
                <div class="line"><div class="label">Telefono</div><div class="value">${escapeHtml(cotizacion.cliente_telefono || "Sin telefono")}</div></div>
                <div class="line"><div class="label">Direccion</div><div class="value">${escapeHtml(cotizacion.cliente_direccion || "Sin direccion")}</div></div>
                <div class="line"><div class="label">Moneda</div><div class="value">${escapeHtml(cotizacion.currency_code || "MXN")}</div></div>
              </div>
            </div>
            <div class="meta-grid">
              <div class="meta-card">
                <div class="meta-head">Credito</div>
                <div class="meta-body">${escapeHtml(cotizacion.cliente_condiciones_credito || "Sin condiciones")}</div>
              </div>
              <div class="meta-card">
                <div class="meta-head">Vigencia</div>
                <div class="meta-body">${escapeHtml(`${cotizacion.vigencia_dias || DEFAULT_VALIDITY_DAYS} dias`)}</div>
              </div>
              <div class="meta-card">
                <div class="meta-head">Moneda</div>
                <div class="meta-body">${escapeHtml(cotizacion.currency_code || "MXN")}</div>
              </div>
              <div class="meta-card">
                <div class="meta-head">Vendedor</div>
                <div class="meta-body">${escapeHtml(cotizacion.vendedor_nombre || "Sin vendedor")}</div>
              </div>
            </div>
            <table>
              <colgroup>
                <col class="col-articulo" />
                <col class="col-nombre" />
                <col class="col-unidad" />
                <col class="col-cantidad" />
                <col class="col-precio" />
                <col class="col-importe" />
              </colgroup>
              <thead>
                <tr>
                  <th>Articulo</th>
                  <th>Nombre</th>
                  <th>U. med.</th>
                  <th>Unidades</th>
                  <th>Precio</th>
                  <th>Importe</th>
                </tr>
              </thead>
              <tbody>${itemsRows}</tbody>
            </table>
            <div class="totals">
              <div class="totals-row"><span>Subtotal</span><strong>${formatCurrency(cotizacion.subtotal, cotizacion.currency_code)}</strong></div>
              <div class="totals-row"><span>IVA ${Number(cotizacion.iva_rate || 0)}%</span><strong>${formatCurrency(cotizacion.iva_amount, cotizacion.currency_code)}</strong></div>
              <div class="totals-row total"><span>Total</span><strong>${formatCurrency(cotizacion.total, cotizacion.currency_code)}</strong></div>
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
  pdf.setFontSize(emphasize ? 12.5 : 10);
  pdf.setTextColor(emphasize ? 15 : 100, emphasize ? 23 : 116, emphasize ? 42 : 139);
  pdf.text(label, x, y);
  pdf.text(value, x + 158, y, { align: "right" });
}

function fitImageIntoBox(imageWidth, imageHeight, maxWidth, maxHeight) {
  if (!imageWidth || !imageHeight) {
    return {
      width: maxWidth,
      height: maxHeight,
    };
  }

  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);

  return {
    width: imageWidth * scale,
    height: imageHeight * scale,
  };
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
      resolve({
        dataUrl: canvas.toDataURL("image/png"),
        width: image.width,
        height: image.height,
      });
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
