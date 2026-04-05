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
  nombre: "",
  empresa: "",
  rfc: "",
  telefono: "",
  email: "",
  direccion: "",
  contacto: "",
};

const REQUEST_TIMEOUT_MS = 10000;
const PROVIDER_TEMPLATE = [
  {
    Nombre: "Proveedor Demo",
    Empresa: "Distribuidora Demo",
    Contacto: "Maria Lopez",
    RFC: "XAXX010101000",
    Telefono: "5550000000",
    Correo: "ventas@proveedor.com",
    Direccion: "Av. Principal 456",
  },
];

const PROVIDER_HEADER_MAP = {
  nombre: ["Nombre", "Proveedor"],
  empresa: ["Empresa"],
  contacto: ["Contacto"],
  rfc: ["RFC"],
  telefono: ["Telefono", "Teléfono"],
  email: ["Correo", "Email"],
  direccion: ["Direccion", "Dirección"],
};

export default function ProveedoresPage({ currentUser, companyId }) {
  const [proveedores, setProveedores] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusDetail, setStatusDetail] = useState("Preparando carga...");
  const importInputRef = useRef(null);

  useEffect(() => {
    loadProveedores();
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

  async function loadProveedores() {
    try {
      setLoading(true);
      setErrorMessage("");
      setMessage("");
      setStatusDetail("Consultando proveedores...");

      const currentCompanyId = getMyCompanyId();

      const { data, error } = await withTimeout(
        supabase
          .from("proveedores")
          .select("id, tenant_id, nombre, empresa, rfc, telefono, email, direccion, contacto")
          .eq("tenant_id", currentCompanyId)
          .is("deleted_at", null)
          .order("nombre", { ascending: true }),
        "consultar proveedores"
      );

      if (error) throw error;

      setProveedores(data || []);
      setStatusDetail(`Carga completa: ${data?.length || 0} proveedor(es).`);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudieron cargar los proveedores.");
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

  function handleEdit(proveedor) {
    setForm({
      id: proveedor.id,
      nombre: proveedor.nombre || "",
      empresa: proveedor.empresa || "",
      rfc: proveedor.rfc || "",
      telefono: proveedor.telefono || "",
      email: proveedor.email || "",
      direccion: proveedor.direccion || "",
      contacto: proveedor.contacto || "",
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
      setStatusDetail("Guardando proveedor...");

      const tenantId = companyId || getMyCompanyId();

      const payload = {
        tenant_id: tenantId,
        nombre: form.nombre.trim(),
        empresa: form.empresa.trim() || null,
        rfc: form.rfc.trim() || null,
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
        direccion: form.direccion.trim() || null,
        contacto: form.contacto.trim() || null,
      };

      if (!payload.nombre) {
        throw new Error("El nombre del proveedor es obligatorio.");
      }

      let result = null;
      let saveError = null;

      if (form.id) {
        const response = await withTimeout(
          supabase
            .from("proveedores")
            .update(payload)
            .eq("id", form.id)
            .select("id, tenant_id, nombre, empresa, rfc, telefono, email, direccion, contacto")
            .single(),
          "actualizar proveedor"
        );

        result = response.data;
        saveError = response.error;
      } else {
        const response = await withTimeout(
          supabase
            .from("proveedores")
            .insert(payload)
            .select("id, tenant_id, nombre, empresa, rfc, telefono, email, direccion, contacto")
            .single(),
          "crear proveedor"
        );

        result = response.data;
        saveError = response.error;
      }

      if (saveError) throw saveError;

      if (result) {
        setProveedores((prev) => {
          const filtered = prev.filter((item) => item.id !== result.id);
          return [...filtered, result].sort((a, b) => a.nombre.localeCompare(b.nombre));
        });
      }

      setMessage(form.id ? "Proveedor actualizado correctamente." : "Proveedor creado correctamente.");
      setForm(initialForm);
      setStatusDetail("Proveedor guardado. Sincronizando listado...");
      loadProveedores();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo guardar el proveedor.");
      setStatusDetail("No se pudo completar el guardado.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(proveedor) {
    const confirmed = window.confirm(`Eliminar al proveedor "${proveedor.nombre}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(proveedor.id);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Eliminando proveedor...");

      const { error } = await withTimeout(
        supabase
          .from("proveedores")
          .update({
            deleted_at: new Date().toISOString(),
            deleted_by: currentUser?.id || null,
            deleted_by_email: currentUser?.email || null,
          })
          .eq("id", proveedor.id),
        "eliminar proveedor"
      );

      if (error) throw error;

      setProveedores((prev) => prev.filter((item) => item.id !== proveedor.id));
      if (form.id === proveedor.id) {
        setForm(initialForm);
      }
      setMessage("Proveedor eliminado correctamente.");
      setStatusDetail("Proveedor eliminado.");
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo eliminar el proveedor.");
      setStatusDetail("No se pudo completar la eliminacion.");
    } finally {
      setDeletingId("");
    }
  }

  function handleDownloadTemplate() {
    downloadExcelTemplate("plantilla-proveedores.xlsx", "Proveedores", PROVIDER_TEMPLATE);
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
      setStatusDetail("Leyendo archivo de proveedores...");

      const tenantId = companyId || getMyCompanyId();
      const excelRows = await readExcelRows(file);
      const mappedRows = mapExcelRows(excelRows, PROVIDER_HEADER_MAP)
        .map((row) => ({
          nombre: normalizeText(row.nombre),
          empresa: normalizeText(row.empresa),
          contacto: normalizeText(row.contacto),
          rfc: normalizeText(row.rfc),
          telefono: normalizeText(row.telefono),
          email: normalizeText(row.email),
          direccion: normalizeText(row.direccion),
        }))
        .filter((row) => row.nombre);

      if (!mappedRows.length) {
        throw new Error("El archivo no contiene proveedores validos. Usa la plantilla para importar.");
      }

      const { data: existingRows, error: existingError } = await withTimeout(
        supabase
          .from("proveedores")
          .select("id, nombre, empresa, email")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null),
        "consultar proveedores existentes"
      );

      if (existingError) throw existingError;

      const existingMap = new Map(
        (existingRows || []).map((row) => [
          normalizeLookupKey([row.nombre, row.empresa || "", row.email || ""]),
          row.id,
        ])
      );

      const updates = [];
      const inserts = [];

      mappedRows.forEach((row) => {
        const payload = {
          tenant_id: tenantId,
          nombre: row.nombre,
          empresa: row.empresa || null,
          contacto: row.contacto || null,
          rfc: row.rfc || null,
          telefono: row.telefono || null,
          email: row.email || null,
          direccion: row.direccion || null,
        };

        const existingId = existingMap.get(
          normalizeLookupKey([row.nombre, row.empresa || "", row.email || ""])
        );

        if (existingId) {
          updates.push({ id: existingId, payload });
        } else {
          inserts.push(payload);
        }
      });

      for (const update of updates) {
        const { error } = await withTimeout(
          supabase.from("proveedores").update(update.payload).eq("id", update.id),
          "actualizar proveedores importados"
        );

        if (error) throw error;
      }

      if (inserts.length) {
        const { error } = await withTimeout(
          supabase.from("proveedores").insert(inserts),
          "insertar proveedores importados"
        );

        if (error) throw error;
      }

      setMessage(
        `Importacion completada. ${inserts.length} proveedor(es) nuevos y ${updates.length} actualizado(s).`
      );
      await loadProveedores();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo importar el archivo de proveedores.");
      setStatusDetail("La importacion se detuvo.");
    } finally {
      setSaving(false);
      event.target.value = "";
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Proveedores</h1>
        <p>Captura y organiza los datos de tus proveedores por empresa.</p>
      </div>

      <div className="providers-layout">
        <section className="module-card providers-form-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">{form.id ? "Editar proveedor" : "Nuevo proveedor"}</h2>
              <p className="section-copy">
                {form.id
                  ? "Actualiza los datos del proveedor seleccionado."
                  : "Da de alta contactos clave para compras y abastecimiento."}
              </p>
            </div>
          </div>

          <form className="providers-form" onSubmit={handleSubmit}>
            <div className="providers-form-grid">
              <div className="form-group">
                <label>Nombre</label>
                <input
                  name="nombre"
                  value={form.nombre}
                  onChange={handleChange}
                  placeholder="Nombre del proveedor"
                  required
                />
              </div>

              <div className="form-group">
                <label>Empresa</label>
                <input
                  name="empresa"
                  value={form.empresa}
                  onChange={handleChange}
                  placeholder="Razon social o nombre comercial"
                />
              </div>

              <div className="form-group">
                <label>Contacto</label>
                <input
                  name="contacto"
                  value={form.contacto}
                  onChange={handleChange}
                  placeholder="Persona de contacto"
                />
              </div>

              <div className="form-group">
                <label>RFC</label>
                <input
                  name="rfc"
                  value={form.rfc}
                  onChange={handleChange}
                  placeholder="RFC"
                />
              </div>

              <div className="form-group">
                <label>Telefono</label>
                <input
                  name="telefono"
                  value={form.telefono}
                  onChange={handleChange}
                  placeholder="Telefono"
                />
              </div>

              <div className="form-group">
                <label>Correo</label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="correo@proveedor.com"
                />
              </div>

              <div className="form-group form-group-full">
                <label>Direccion</label>
                <textarea
                  name="direccion"
                  value={form.direccion}
                  onChange={handleChange}
                  rows="3"
                  placeholder="Direccion fiscal o de entrega"
                />
              </div>
            </div>

            <div className="settings-actions providers-actions">
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? "Guardando..." : form.id ? "Guardar cambios" : "Crear proveedor"}
              </button>

              {form.id ? (
                <button type="button" className="secondary-btn" onClick={handleCancel} disabled={saving}>
                  Cancelar
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="module-card providers-catalog-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Listado de proveedores</h2>
              <p className="section-copy">
                {loading ? "Cargando proveedores..." : `${proveedores.length} proveedor(es) encontrados.`}
              </p>
              <p className="section-copy">{statusDetail}</p>
            </div>

            <button type="button" className="secondary-btn" onClick={loadProveedores} disabled={loading}>
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

          {!loading && proveedores.length === 0 && !errorMessage ? (
            <div className="empty-state">
              <strong>No hay proveedores capturados todavia.</strong>
              <span>Usa el formulario superior para registrar el primero.</span>
            </div>
          ) : null}

          {proveedores.length > 0 ? (
            <div className="table-wrap">
              <table className="table providers-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Empresa</th>
                    <th>Contacto</th>
                    <th>RFC</th>
                    <th>Telefono</th>
                    <th>Correo</th>
                    <th>Direccion</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {proveedores.map((proveedor) => (
                    <tr key={proveedor.id}>
                      <td>{proveedor.nombre}</td>
                      <td>{proveedor.empresa || "-"}</td>
                      <td>{proveedor.contacto || "-"}</td>
                      <td>{proveedor.rfc || "-"}</td>
                      <td>{proveedor.telefono || "-"}</td>
                      <td>{proveedor.email || "-"}</td>
                      <td className="providers-address-cell">{proveedor.direccion || "-"}</td>
                      <td>
                        <div className="providers-table-actions">
                          <button
                            type="button"
                            className="table-action-btn"
                            onClick={() => handleEdit(proveedor)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="table-action-btn table-action-btn-danger"
                            onClick={() => handleDelete(proveedor)}
                            disabled={deletingId === proveedor.id}
                          >
                            {deletingId === proveedor.id ? "Eliminando..." : "Eliminar"}
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
