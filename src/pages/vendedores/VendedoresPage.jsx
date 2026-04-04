import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const initialForm = {
  id: null,
  nombre: "",
  email: "",
  telefono: "",
  comision: "",
  firmaUrl: "",
  activo: true,
};

const REQUEST_TIMEOUT_MS = 10000;

export default function VendedoresPage({ currentUser, companyId }) {
  const [vendedores, setVendedores] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusDetail, setStatusDetail] = useState("Preparando carga...");

  useEffect(() => {
    loadVendedores();
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

  async function loadVendedores() {
    try {
      setLoading(true);
      setErrorMessage("");
      setMessage("");
      setStatusDetail("Consultando vendedores...");

      const currentCompanyId = getMyCompanyId();

      const { data, error } = await withTimeout(
        supabase
          .from("vendedores")
          .select("id, tenant_id, nombre, email, telefono, comision, firma_url, activo, created_at")
          .eq("tenant_id", currentCompanyId)
          .order("nombre", { ascending: true }),
        "consultar vendedores"
      );

      if (error) throw error;

      setVendedores(data || []);
      setStatusDetail(`Carga completa: ${data?.length || 0} vendedor(es).`);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudieron cargar los vendedores.");
      setStatusDetail("La carga se detuvo.");
    } finally {
      setLoading(false);
    }
  }

  function handleChange(event) {
    const { name, value, type, checked } = event.target;
    setForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function handleEdit(vendedor) {
    setForm({
      id: vendedor.id,
      nombre: vendedor.nombre || "",
      email: vendedor.email || "",
      telefono: vendedor.telefono || "",
      comision: vendedor.comision == null ? "" : String(vendedor.comision),
      firmaUrl: vendedor.firma_url || "",
      activo: vendedor.activo !== false,
    });
    setMessage("");
    setErrorMessage("");
  }

  function handleCancel() {
    setForm(initialForm);
    setMessage("");
    setErrorMessage("");
  }

  async function handleSignatureChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setErrorMessage("");
      setMessage("");

      if (!file.type.startsWith("image/")) {
        throw new Error("Selecciona una imagen valida para la firma.");
      }

      if (file.size > 1024 * 1024) {
        throw new Error("La firma no debe pesar mas de 1 MB.");
      }

      const firmaUrl = await readFileAsDataUrl(file);
      setForm((previous) => ({
        ...previous,
        firmaUrl,
      }));
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo cargar la firma.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Guardando vendedor...");

      const tenantId = companyId || getMyCompanyId();

      const payload = {
        tenant_id: tenantId,
        nombre: form.nombre.trim(),
        email: form.email.trim() || null,
        telefono: form.telefono.trim() || null,
        comision: form.comision === "" ? null : Number(form.comision),
        firma_url: form.firmaUrl || null,
        activo: Boolean(form.activo),
      };

      if (!payload.nombre) {
        throw new Error("El nombre del vendedor es obligatorio.");
      }

      let result = null;
      let saveError = null;

      if (form.id) {
        const response = await withTimeout(
          supabase
            .from("vendedores")
            .update(payload)
            .eq("id", form.id)
            .select("id, tenant_id, nombre, email, telefono, comision, firma_url, activo, created_at")
            .single(),
          "actualizar vendedor"
        );

        result = response.data;
        saveError = response.error;
      } else {
        const response = await withTimeout(
          supabase
            .from("vendedores")
            .insert(payload)
            .select("id, tenant_id, nombre, email, telefono, comision, firma_url, activo, created_at")
            .single(),
          "crear vendedor"
        );

        result = response.data;
        saveError = response.error;
      }

      if (saveError) throw saveError;

      if (result) {
        setVendedores((previous) => {
          const filtered = previous.filter((item) => item.id !== result.id);
          return [...filtered, result].sort((a, b) => a.nombre.localeCompare(b.nombre));
        });
      }

      setMessage(form.id ? "Vendedor actualizado correctamente." : "Vendedor creado correctamente.");
      setForm(initialForm);
      setStatusDetail("Vendedor guardado. Sincronizando listado...");
      loadVendedores();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo guardar el vendedor.");
      setStatusDetail("No se pudo completar el guardado.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(vendedor) {
    const confirmed = window.confirm(`Eliminar al vendedor "${vendedor.nombre}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(vendedor.id);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Eliminando vendedor...");

      const { error } = await withTimeout(
        supabase.from("vendedores").delete().eq("id", vendedor.id),
        "eliminar vendedor"
      );

      if (error) throw error;

      setVendedores((previous) => previous.filter((item) => item.id !== vendedor.id));
      if (form.id === vendedor.id) {
        setForm(initialForm);
      }

      setMessage("Vendedor eliminado correctamente.");
      setStatusDetail("Vendedor eliminado.");
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo eliminar el vendedor.");
      setStatusDetail("No se pudo completar la eliminacion.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Vendedores</h1>
        <p>Da de alta al equipo comercial y relaciona vendedores en las cotizaciones.</p>
      </div>

      <div className="vendors-layout">
        <section className="module-card vendors-form-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">{form.id ? "Editar vendedor" : "Nuevo vendedor"}</h2>
              <p className="section-copy">
                {form.id
                  ? "Actualiza la informacion del vendedor seleccionado."
                  : "Registra vendedores activos para relacionarlos con clientes y cotizaciones."}
              </p>
            </div>
          </div>

          <form className="vendors-form" onSubmit={handleSubmit}>
            <div className="vendors-form-grid">
              <div className="form-group">
                <label>Nombre</label>
                <input
                  name="nombre"
                  value={form.nombre}
                  onChange={handleChange}
                  placeholder="Nombre del vendedor"
                  required
                />
              </div>

              <div className="form-group">
                <label>Correo</label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="vendedor@empresa.com"
                />
              </div>

              <div className="form-group">
                <label>Telefono</label>
                <input
                  name="telefono"
                  value={form.telefono}
                  onChange={handleChange}
                  placeholder="Telefono de contacto"
                />
              </div>

              <div className="form-group vendors-number-field">
                <label>Comision (%)</label>
                <input
                  name="comision"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.comision}
                  onChange={handleChange}
                  placeholder="0.00"
                />
              </div>

              <div className="form-group">
                <label className="vendors-toggle-label">
                  <input
                    name="activo"
                    type="checkbox"
                    checked={form.activo}
                    onChange={handleChange}
                  />
                  <span>Vendedor activo</span>
                </label>
              </div>

              <div className="form-group form-group-full">
                <label>Firma del vendedor (opcional)</label>
                <input type="file" accept="image/*" onChange={handleSignatureChange} />
                <p className="section-copy">
                  Carga una imagen ligera de la firma. Se agregara automaticamente en las cotizaciones.
                </p>
                {form.firmaUrl ? (
                  <div className="vendors-signature-preview">
                    <img src={form.firmaUrl} alt={`Firma de ${form.nombre || "vendedor"}`} />
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setForm((previous) => ({ ...previous, firmaUrl: "" }))}
                    >
                      Quitar firma
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="settings-actions vendors-actions">
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? "Guardando..." : form.id ? "Guardar cambios" : "Crear vendedor"}
              </button>

              {form.id ? (
                <button type="button" className="secondary-btn" onClick={handleCancel} disabled={saving}>
                  Cancelar
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="module-card vendors-catalog-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Listado de vendedores</h2>
              <p className="section-copy">
                {loading ? "Cargando vendedores..." : `${vendedores.length} vendedor(es) encontrados.`}
              </p>
              <p className="section-copy">{statusDetail}</p>
            </div>

            <button type="button" className="secondary-btn" onClick={loadVendedores} disabled={loading}>
              {loading ? "Actualizando..." : "Recargar"}
            </button>
          </div>

          {errorMessage ? <p className="form-message form-message-error">{errorMessage}</p> : null}
          {message ? <p className="form-message form-message-success">{message}</p> : null}

          {!loading && vendedores.length === 0 && !errorMessage ? (
            <div className="empty-state">
              <strong>No hay vendedores capturados todavia.</strong>
              <span>Usa el formulario superior para registrar el primero.</span>
            </div>
          ) : null}

          {vendedores.length > 0 ? (
            <div className="table-wrap">
              <table className="table vendors-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Telefono</th>
                    <th>Comision</th>
                    <th>Firma</th>
                    <th>Estatus</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {vendedores.map((vendedor) => (
                    <tr key={vendedor.id}>
                      <td>{vendedor.nombre}</td>
                      <td>{vendedor.email || "-"}</td>
                      <td>{vendedor.telefono || "-"}</td>
                      <td>{vendedor.comision == null ? "-" : `${Number(vendedor.comision).toFixed(2)}%`}</td>
                      <td>
                        {vendedor.firma_url ? (
                          <div className="vendors-signature-thumb">
                            <img src={vendedor.firma_url} alt={`Firma de ${vendedor.nombre}`} />
                          </div>
                        ) : "-"}
                      </td>
                      <td>
                        <span
                          className={
                            vendedor.activo === false
                              ? "status-chip status-chip-danger"
                              : "status-chip status-chip-success"
                          }
                        >
                          {vendedor.activo === false ? "Inactivo" : "Activo"}
                        </span>
                      </td>
                      <td>
                        <div className="vendors-table-actions">
                          <button
                            type="button"
                            className="table-action-btn"
                            onClick={() => handleEdit(vendedor)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="table-action-btn table-action-btn-danger"
                            onClick={() => handleDelete(vendedor)}
                            disabled={deletingId === vendedor.id}
                          >
                            {deletingId === vendedor.id ? "Eliminando..." : "Eliminar"}
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
    reader.readAsDataURL(file);
  });
}
