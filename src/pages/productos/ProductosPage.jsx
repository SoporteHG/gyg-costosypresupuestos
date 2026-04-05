import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  downloadExcelTemplate,
  mapExcelRows,
  normalizeLookupKey,
  normalizeText,
  readExcelRows,
} from "../../lib/excel";

const initialForm = {
  id: null,
  sku: "",
  nombre: "",
  categoria: "",
  marca: "",
  unidad: "",
  descripcion: "",
  costo: "",
  precio: "",
};

const REQUEST_TIMEOUT_MS = 10000;
const PRODUCT_TEMPLATE = [
  {
    SKU: "ABC001",
    Nombre: "Cable de prueba",
    Categoria: "Cableado",
    Marca: "Condumex",
    Unidad: "Rollo",
    Descripcion: "Cable calibre 12 de ejemplo",
    Costo: "850",
    Precio: "1250",
  },
];

const PRODUCT_HEADER_MAP = {
  sku: ["SKU", "Codigo", "Codigo de barras"],
  nombre: ["Nombre", "Producto"],
  categoria: ["Categoria"],
  marca: ["Marca"],
  unidad: ["Unidad"],
  descripcion: ["Descripcion"],
  costo: ["Costo"],
  precio: ["Precio"],
};

export default function ProductosPage({ currentUser, companyId }) {
  const [productos, setProductos] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusDetail, setStatusDetail] = useState("Preparando carga...");
  const importInputRef = useRef(null);

  useEffect(() => {
    loadProductos();
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

  async function loadProductos() {
    try {
      setLoading(true);
      setErrorMessage("");
      setMessage("");
      setStatusDetail("Resolviendo empresa...");

      const currentCompanyId = getMyCompanyId();
      setStatusDetail("Consultando productos en Supabase...");

      const { data, error } = await withTimeout(
        supabase
          .from("productos")
          .select("id, tenant_id, sku, nombre, categoria, marca, unidad, descripcion, costo, precio")
          .eq("tenant_id", currentCompanyId)
          .is("deleted_at", null)
          .order("nombre", { ascending: true }),
        "consultar productos"
      );

      if (error) throw error;

      setProductos(data || []);
      setStatusDetail(`Carga completa: ${data?.length || 0} producto(s).`);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudieron cargar los productos.");
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

  function handleEdit(producto) {
    setForm({
      id: producto.id,
      sku: producto.sku || "",
      nombre: producto.nombre || "",
      categoria: producto.categoria || "",
      marca: producto.marca || "",
      unidad: producto.unidad || "",
      descripcion: producto.descripcion || "",
      costo: producto.costo ?? "",
      precio: producto.precio ?? "",
    });
    setMessage("");
    setErrorMessage("");
  }

  function handleCancel() {
    setForm(initialForm);
    setMessage("");
    setErrorMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Guardando producto...");

      const tenantId = companyId || getMyCompanyId();
      const sku = form.sku.trim();
      const nombre = form.nombre.trim();
      const categoria = form.categoria.trim();
      const marca = form.marca.trim();
      const unidad = form.unidad.trim();
      const descripcion = form.descripcion.trim();
      const costo = Number(form.costo);
      const precio = Number(form.precio);

      if (!nombre) {
        throw new Error("El nombre del producto es obligatorio.");
      }

      if (!sku) {
        throw new Error("El SKU es obligatorio.");
      }

      if (!Number.isFinite(costo) || costo < 0) {
        throw new Error("Captura un costo valido mayor o igual a cero.");
      }

      if (!Number.isFinite(precio) || precio < 0) {
        throw new Error("Captura un precio valido mayor o igual a cero.");
      }

      const payload = {
        tenant_id: tenantId,
        sku,
        nombre,
        categoria: categoria || null,
        marca: marca || null,
        unidad: unidad || null,
        descripcion: descripcion || null,
        costo,
        precio,
      };

      let saveError = null;
      let savedRow = null;

      if (form.id) {
        const { data, error } = await withTimeout(
          supabase
            .from("productos")
            .update(payload)
            .eq("id", form.id)
            .select("id, tenant_id, sku, nombre, categoria, marca, unidad, descripcion, costo, precio")
            .single(),
          "actualizar producto"
        );

        savedRow = data;
        saveError = error;
      } else {
        const { data, error } = await withTimeout(
          supabase
            .from("productos")
            .insert(payload)
            .select("id, tenant_id, sku, nombre, categoria, marca, unidad, descripcion, costo, precio")
            .single(),
          "crear producto"
        );

        savedRow = data;
        saveError = error;
      }

      if (saveError) throw saveError;

      if (savedRow) {
        setProductos((prev) => {
          const filtered = prev.filter((producto) => producto.id !== savedRow.id);
          return [...filtered, savedRow].sort((a, b) => a.nombre.localeCompare(b.nombre));
        });
      }

      setMessage(form.id ? "Producto actualizado correctamente." : "Producto creado correctamente.");
      setForm(initialForm);
      setStatusDetail("Producto guardado. Sincronizando listado...");
      loadProductos();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo guardar el producto.");
      setStatusDetail("No se pudo completar el guardado.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(producto) {
    const confirmed = window.confirm(`Eliminar el producto "${producto.nombre}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(producto.id);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Eliminando producto...");

      const { error } = await withTimeout(
        supabase
          .from("productos")
          .update({
            deleted_at: new Date().toISOString(),
            deleted_by: currentUser?.id || null,
            deleted_by_email: currentUser?.email || null,
          })
          .eq("id", producto.id),
        "eliminar producto"
      );

      if (error) throw error;

      setProductos((prev) => prev.filter((item) => item.id !== producto.id));
      if (form.id === producto.id) {
        setForm(initialForm);
      }
      setMessage("Producto eliminado correctamente.");
      setStatusDetail("Producto eliminado.");
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo eliminar el producto.");
      setStatusDetail("No se pudo completar la eliminacion.");
    } finally {
      setDeletingId("");
    }
  }

  function handleDownloadTemplate() {
    downloadExcelTemplate("plantilla-productos.xlsx", "Productos", PRODUCT_TEMPLATE);
  }

  function openImportDialog() {
    importInputRef.current?.click();
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setSaving(true);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Leyendo archivo de productos...");

      const tenantId = companyId || getMyCompanyId();
      const excelRows = await readExcelRows(file);
      const mappedRows = mapExcelRows(excelRows, PRODUCT_HEADER_MAP)
        .map((row) => ({
          sku: normalizeText(row.sku),
          nombre: normalizeText(row.nombre),
          categoria: normalizeText(row.categoria),
          marca: normalizeText(row.marca),
          unidad: normalizeText(row.unidad),
          descripcion: normalizeText(row.descripcion),
          costo: Number(row.costo || 0),
          precio: Number(row.precio || 0),
        }))
        .filter((row) => row.sku && row.nombre);

      if (!mappedRows.length) {
        throw new Error("El archivo no contiene productos validos. Usa la plantilla para importar.");
      }

      const { data: existingRows, error: existingError } = await withTimeout(
        supabase
          .from("productos")
          .select("id, sku")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null),
        "consultar productos existentes"
      );

      if (existingError) throw existingError;

      const existingMap = new Map(
        (existingRows || []).map((row) => [normalizeLookupKey([row.sku]), row.id])
      );

      const updates = [];
      const inserts = [];

      mappedRows.forEach((row) => {
        const payload = {
          tenant_id: tenantId,
          sku: row.sku,
          nombre: row.nombre,
          categoria: row.categoria || null,
          marca: row.marca || null,
          unidad: row.unidad || null,
          descripcion: row.descripcion || null,
          costo: Number.isFinite(row.costo) ? row.costo : 0,
          precio: Number.isFinite(row.precio) ? row.precio : 0,
        };

        const existingId = existingMap.get(normalizeLookupKey([row.sku]));
        if (existingId) {
          updates.push({ id: existingId, payload });
        } else {
          inserts.push(payload);
        }
      });

      for (const update of updates) {
        const { error } = await withTimeout(
          supabase.from("productos").update(update.payload).eq("id", update.id),
          "actualizar productos importados"
        );

        if (error) throw error;
      }

      if (inserts.length) {
        const { error } = await withTimeout(
          supabase.from("productos").insert(inserts),
          "insertar productos importados"
        );

        if (error) throw error;
      }

      setMessage(
        `Importacion completada. ${inserts.length} producto(s) nuevos y ${updates.length} actualizado(s).`
      );
      await loadProductos();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo importar el archivo de productos.");
      setStatusDetail("La importacion se detuvo.");
    } finally {
      setSaving(false);
      event.target.value = "";
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Productos</h1>
        <p>Administra tu catalogo de productos y servicios por empresa.</p>
      </div>

      <div className="products-layout">
        <section className="module-card products-form-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">{form.id ? "Editar producto" : "Nuevo producto"}</h2>
              <p className="section-copy">
                {form.id
                  ? "Actualiza la informacion del producto seleccionado."
                  : "Captura SKU, categoria, marca, costos y precio base de venta."}
              </p>
            </div>
          </div>

          <form className="products-form" onSubmit={handleSubmit}>
            <div className="products-form-grid">
              <div className="form-group">
                <label>SKU / Codigo de barras</label>
                <input
                  name="sku"
                  value={form.sku}
                  onChange={handleChange}
                  placeholder="Escanea o captura el SKU"
                  autoComplete="off"
                  required
                />
              </div>

              <div className="form-group">
                <label>Nombre</label>
                <input
                  name="nombre"
                  value={form.nombre}
                  onChange={handleChange}
                  placeholder="Nombre del producto o servicio"
                  required
                />
              </div>

              <div className="form-group">
                <label>Categoria</label>
                <input
                  name="categoria"
                  value={form.categoria}
                  onChange={handleChange}
                  placeholder="Categoria del producto"
                />
              </div>

              <div className="form-group">
                <label>Marca</label>
                <input
                  name="marca"
                  value={form.marca}
                  onChange={handleChange}
                  placeholder="Marca"
                />
              </div>

              <div className="form-group">
                <label>Unidad</label>
                <input
                  name="unidad"
                  value={form.unidad}
                  onChange={handleChange}
                  placeholder="pieza, metro, caja, servicio..."
                />
              </div>

              <div className="form-group products-metric-field">
                <label>Costo</label>
                <input
                  name="costo"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.costo}
                  onChange={handleChange}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="form-group products-metric-field">
                <label>Precio</label>
                <input
                  name="precio"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.precio}
                  onChange={handleChange}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="form-group form-group-full">
                <label>Descripcion</label>
                <textarea
                  name="descripcion"
                  value={form.descripcion}
                  onChange={handleChange}
                  rows="3"
                  placeholder="Describe lo que incluye este producto o servicio"
                />
              </div>
            </div>

            <div className="settings-actions products-actions">
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? "Guardando..." : form.id ? "Guardar cambios" : "Crear producto"}
              </button>

              {form.id ? (
                <button type="button" className="secondary-btn" onClick={handleCancel} disabled={saving}>
                  Cancelar
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="module-card products-catalog-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Catalogo</h2>
              <p className="section-copy">
                {loading ? "Cargando productos..." : `${productos.length} producto(s) encontrados.`}
              </p>
              <p className="section-copy">{statusDetail}</p>
            </div>

            <button type="button" className="secondary-btn" onClick={loadProductos} disabled={loading}>
              {loading ? "Actualizando..." : "Recargar"}
            </button>
          </div>

          <div className="settings-inline-actions">
            <button type="button" className="secondary-btn" onClick={handleDownloadTemplate}>
              Descargar plantilla
            </button>
            <button type="button" className="secondary-btn" onClick={openImportDialog} disabled={saving}>
              {saving ? "Importando..." : "Importar Excel"}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportFile}
              style={{ display: "none" }}
            />
          </div>

          {errorMessage ? <p className="form-message form-message-error">{errorMessage}</p> : null}
          {message ? <p className="form-message form-message-success">{message}</p> : null}

          {!loading && productos.length === 0 && !errorMessage ? (
            <div className="empty-state">
              <strong>No hay productos capturados todavia.</strong>
              <span>Usa el formulario superior para crear el primero.</span>
            </div>
          ) : null}

          {productos.length > 0 ? (
            <div className="table-wrap">
              <table className="table products-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Nombre</th>
                    <th>Categoria</th>
                    <th>Marca</th>
                    <th>Unidad</th>
                    <th>Descripcion</th>
                    <th>Costo</th>
                    <th>Precio</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((producto) => (
                    <tr key={producto.id}>
                      <td>{producto.sku || "-"}</td>
                      <td>{producto.nombre}</td>
                      <td>{producto.categoria || "-"}</td>
                      <td>{producto.marca || "-"}</td>
                      <td>{producto.unidad || "-"}</td>
                      <td className="products-description-cell">{producto.descripcion || "-"}</td>
                      <td>{formatCurrency(producto.costo)}</td>
                      <td>{formatCurrency(producto.precio)}</td>
                      <td>
                        <div className="products-table-actions">
                          <button
                            type="button"
                            className="table-action-btn"
                            onClick={() => handleEdit(producto)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="table-action-btn table-action-btn-danger"
                            onClick={() => handleDelete(producto)}
                            disabled={deletingId === producto.id}
                          >
                            {deletingId === producto.id ? "Eliminando..." : "Eliminar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}
