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
  direccion: "",
  email: "",
  condiciones_credito: "",
  centro_costos: "MXN",
};

const REQUEST_TIMEOUT_MS = 10000;
const CLIENT_TEMPLATE = [
  {
    Nombre: "Cliente Demo",
    Empresa: "Empresa Demo",
    RFC: "XAXX010101000",
    Telefono: "5550000000",
    Direccion: "Calle Ejemplo 123",
    Correo: "cliente@demo.com",
    "Condiciones de credito": "Credito a 15 dias",
    "Centro de costos": "MXN",
  },
];

const CLIENT_HEADER_MAP = {
  nombre: ["Nombre", "Cliente"],
  empresa: ["Empresa"],
  rfc: ["RFC"],
  telefono: ["Telefono", "Telefono de contacto"],
  direccion: ["Direccion", "Domicilio"],
  email: ["Correo", "Email"],
  condiciones_credito: ["Condiciones de credito", "Credito", "Condiciones"],
  centro_costos: ["Centro de costos", "Moneda", "Centro costos"],
};

export default function ClientesManagerPage({ currentUser, companyId }) {
  const [clientes, setClientes] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusDetail, setStatusDetail] = useState("Preparando carga...");
  const importInputRef = useRef(null);

  useEffect(() => {
    loadClientes();
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

  async function loadClientes() {
    try {
      setLoading(true);
      setErrorMessage("");
      setMessage("");
      setStatusDetail("Resolviendo empresa...");

      const currentCompanyId = getMyCompanyId();
      setStatusDetail("Consultando clientes en Supabase...");

      const { data, error } = await withTimeout(
        supabase
          .from("clientes")
          .select(
            "id, tenant_id, nombre, empresa, rfc, telefono, direccion, email, condiciones_credito, centro_costos"
          )
          .eq("tenant_id", currentCompanyId)
          .order("nombre", { ascending: true }),
        "consultar clientes"
      );

      if (error) throw error;

      setClientes(data || []);
      setStatusDetail(`Carga completa: ${data?.length || 0} cliente(s).`);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudieron cargar los clientes.");
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

  function handleEdit(cliente) {
    setForm({
      id: cliente.id,
      nombre: cliente.nombre || "",
      empresa: cliente.empresa || "",
      rfc: cliente.rfc || "",
      telefono: cliente.telefono || "",
      direccion: cliente.direccion || "",
      email: cliente.email || "",
      condiciones_credito: cliente.condiciones_credito || "",
      centro_costos: cliente.centro_costos || "MXN",
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
      setStatusDetail("Guardando cliente...");

      const tenantId = companyId || getMyCompanyId();

      const payload = {
        nombre: form.nombre.trim(),
        empresa: form.empresa.trim() || null,
        rfc: form.rfc.trim() || null,
        telefono: form.telefono.trim() || null,
        direccion: form.direccion.trim() || null,
        email: form.email.trim() || null,
        condiciones_credito: form.condiciones_credito.trim() || null,
        centro_costos: form.centro_costos === "USD" ? "USD" : "MXN",
        tenant_id: tenantId,
      };

      if (!payload.nombre) {
        throw new Error("El nombre del cliente es obligatorio.");
      }

      let saveError = null;
      let savedRow = null;

      if (form.id) {
        const { data, error } = await withTimeout(
          supabase
            .from("clientes")
            .update(payload)
            .eq("id", form.id)
            .select(
              "id, tenant_id, nombre, empresa, rfc, telefono, direccion, email, condiciones_credito, centro_costos"
            )
            .single(),
          "actualizar cliente"
        );

        savedRow = data;
        saveError = error;
      } else {
        const { data, error } = await withTimeout(
          supabase
            .from("clientes")
            .insert(payload)
            .select(
              "id, tenant_id, nombre, empresa, rfc, telefono, direccion, email, condiciones_credito, centro_costos"
            )
            .single(),
          "crear cliente"
        );

        savedRow = data;
        saveError = error;
      }

      if (saveError) throw saveError;

      if (savedRow) {
        setClientes((prev) => {
          const filtered = prev.filter((cliente) => cliente.id !== savedRow.id);
          return [...filtered, savedRow].sort((a, b) => a.nombre.localeCompare(b.nombre));
        });
      }

      setMessage(form.id ? "Cliente actualizado correctamente." : "Cliente creado correctamente.");
      setForm(initialForm);
      setStatusDetail("Cliente guardado. Sincronizando listado...");
      loadClientes();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo guardar el cliente.");
      setStatusDetail("No se pudo completar el guardado.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(cliente) {
    const confirmed = window.confirm(`Eliminar al cliente "${cliente.nombre}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(cliente.id);
      setMessage("");
      setErrorMessage("");
      setStatusDetail("Eliminando cliente...");

      const { error } = await withTimeout(
        supabase.from("clientes").delete().eq("id", cliente.id),
        "eliminar cliente"
      );

      if (error) throw error;

      setClientes((prev) => prev.filter((item) => item.id !== cliente.id));
      if (form.id === cliente.id) {
        setForm(initialForm);
      }
      setMessage("Cliente eliminado correctamente.");
      setStatusDetail("Cliente eliminado.");
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo eliminar el cliente.");
      setStatusDetail("No se pudo completar la eliminacion.");
    } finally {
      setDeletingId("");
    }
  }

  function handleDownloadTemplate() {
    downloadExcelTemplate("plantilla-clientes.xlsx", "Clientes", CLIENT_TEMPLATE);
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
      setStatusDetail("Leyendo archivo de clientes...");

      const tenantId = companyId || getMyCompanyId();
      const excelRows = await readExcelRows(file);
      const mappedRows = mapExcelRows(excelRows, CLIENT_HEADER_MAP)
        .map((row) => ({
          nombre: normalizeText(row.nombre),
          empresa: normalizeText(row.empresa),
          rfc: normalizeText(row.rfc),
          telefono: normalizeText(row.telefono),
          direccion: normalizeText(row.direccion),
          email: normalizeText(row.email),
          condiciones_credito: normalizeText(row.condiciones_credito),
          centro_costos: normalizeText(row.centro_costos).toUpperCase() || "MXN",
        }))
        .filter((row) => row.nombre);

      if (!mappedRows.length) {
        throw new Error("El archivo no contiene clientes validos. Usa la plantilla para importar.");
      }

      const { data: existingRows, error: existingError } = await withTimeout(
        supabase.from("clientes").select("id, nombre, empresa, email").eq("tenant_id", tenantId),
        "consultar clientes existentes"
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
          rfc: row.rfc || null,
          telefono: row.telefono || null,
          direccion: row.direccion || null,
          email: row.email || null,
          condiciones_credito: row.condiciones_credito || null,
          centro_costos: row.centro_costos === "USD" ? "USD" : "MXN",
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
          supabase.from("clientes").update(update.payload).eq("id", update.id),
          "actualizar clientes importados"
        );

        if (error) throw error;
      }

      if (inserts.length) {
        const { error } = await withTimeout(
          supabase.from("clientes").insert(inserts),
          "insertar clientes importados"
        );

        if (error) throw error;
      }

      setMessage(
        `Importacion completada. ${inserts.length} cliente(s) nuevos y ${updates.length} actualizado(s).`
      );
      await loadClientes();
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "No se pudo importar el archivo de clientes.");
      setStatusDetail("La importacion se detuvo.");
    } finally {
      setSaving(false);
      event.target.value = "";
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Clientes</h1>
        <p>Consulta tu cartera y edita los datos principales de cada cliente.</p>
      </div>

      <div className="clients-layout">
        <section className="module-card clients-form-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">{form.id ? "Editar cliente" : "Nuevo cliente"}</h2>
              <p className="section-copy">
                {form.id
                  ? "Actualiza los datos del cliente seleccionado."
                  : "Captura los datos principales para darlo de alta."}
              </p>
            </div>
          </div>

          <form className="clients-form" onSubmit={handleSubmit}>
            <div className="clients-form-grid">
              <div className="form-group">
                <label>Nombre</label>
                <input
                  name="nombre"
                  value={form.nombre}
                  onChange={handleChange}
                  placeholder="Nombre del cliente"
                  required
                />
              </div>

              <div className="form-group">
                <label>Empresa</label>
                <input
                  name="empresa"
                  value={form.empresa}
                  onChange={handleChange}
                  placeholder="Nombre de la empresa"
                />
              </div>

              <div className="form-group">
                <label>RFC</label>
                <input
                  name="rfc"
                  value={form.rfc}
                  onChange={handleChange}
                  placeholder="RFC del cliente"
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

              <div className="form-group">
                <label>Correo</label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="correo@empresa.com"
                />
              </div>

              <div className="form-group">
                <label>Centro de costos / moneda</label>
                <select
                  name="centro_costos"
                  value={form.centro_costos}
                  onChange={handleChange}
                  className="quotes-select"
                >
                  <option value="MXN">MXN</option>
                  <option value="USD">USD</option>
                </select>
              </div>

              <div className="form-group form-group-full">
                <label>Condiciones de credito</label>
                <textarea
                  name="condiciones_credito"
                  value={form.condiciones_credito}
                  onChange={handleChange}
                  rows="3"
                  placeholder="Credito a 15 dias, pago contra entrega, limite de credito..."
                />
              </div>

              <div className="form-group form-group-full">
                <label>Direccion</label>
                <textarea
                  name="direccion"
                  value={form.direccion}
                  onChange={handleChange}
                  rows="3"
                  placeholder="Direccion del cliente"
                />
              </div>
            </div>

            <div className="settings-actions clients-actions">
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? "Guardando..." : form.id ? "Guardar cambios" : "Crear cliente"}
              </button>

              {form.id ? (
                <button type="button" className="secondary-btn" onClick={handleCancel} disabled={saving}>
                  Cancelar
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="module-card clients-catalog-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Listado</h2>
              <p className="section-copy">
                {loading ? "Cargando clientes..." : `${clientes.length} cliente(s) encontrados.`}
              </p>
              <p className="section-copy">{statusDetail}</p>
            </div>

            <button type="button" className="secondary-btn" onClick={loadClientes} disabled={loading}>
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

          {!loading && clientes.length === 0 && !errorMessage ? (
            <div className="empty-state">
              <strong>No hay clientes capturados todavia.</strong>
              <span>Usa el formulario superior para crear el primero.</span>
            </div>
          ) : null}

          {clientes.length > 0 ? (
            <div className="table-wrap">
              <table className="table clients-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Empresa</th>
                    <th>RFC</th>
                    <th>Telefono</th>
                    <th>Moneda</th>
                    <th>Credito</th>
                    <th>Direccion</th>
                    <th>Email</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((cliente) => (
                    <tr key={cliente.id}>
                      <td>{cliente.nombre}</td>
                      <td>{cliente.empresa || "-"}</td>
                      <td>{cliente.rfc || "-"}</td>
                      <td>{cliente.telefono || "-"}</td>
                      <td>{cliente.centro_costos || "MXN"}</td>
                      <td className="clients-address-cell">{cliente.condiciones_credito || "-"}</td>
                      <td className="clients-address-cell">{cliente.direccion || "-"}</td>
                      <td>{cliente.email || "-"}</td>
                      <td>
                        <div className="clients-table-actions">
                          <button
                            type="button"
                            className="table-action-btn"
                            onClick={() => handleEdit(cliente)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="table-action-btn table-action-btn-danger"
                            onClick={() => handleDelete(cliente)}
                            disabled={deletingId === cliente.id}
                          >
                            {deletingId === cliente.id ? "Eliminando..." : "Eliminar"}
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
