import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const initialForm = {
  business_name: "",
  legal_name: "",
  rfc: "",
  phone: "",
  email: "",
  address: "",
  website: "",
  logo_url: "",
  signature_url: "",
  primary_color: "#1d4ed8",
  secondary_color: "#0f172a",
  pdf_footer: "",
  default_terms: "",
  default_notes: "",
};

const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

export default function ConfiguracionPage({
  currentUser,
  companyId,
  company,
  branding,
  onBrandingSaved,
}) {
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    loadBranding();
  }, [currentUser?.id, companyId, branding]);

  async function loadBranding() {
    try {
      setLoading(true);
      setMessage("");

      if (!companyId) {
        throw new Error("No se encontro la empresa activa.");
      }

      if (branding) {
        setForm({
          ...initialForm,
          ...branding,
        });
      } else {
        setForm(initialForm);
      }
    } catch (error) {
      console.error(error);
      setMessageType("error");
      setMessage("No se pudo cargar la configuracion de tu empresa.");
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

  async function handleLogoFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMessageType("error");
      setMessage("Selecciona una imagen valida para el logo.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_LOGO_SIZE_BYTES) {
      setMessageType("error");
      setMessage("El logo debe pesar menos de 2 MB.");
      event.target.value = "";
      return;
    }

    try {
      setUploadingLogo(true);
      setMessage("");

      const dataUrl = await readFileAsDataUrl(file);
      setForm((prev) => ({
        ...prev,
        logo_url: dataUrl,
      }));
      setMessageType("info");
      setMessage("Logo cargado. Guarda los cambios para conservarlo.");
    } catch (error) {
      console.error(error);
      setMessageType("error");
      setMessage("No se pudo leer el archivo del logo.");
    } finally {
      setUploadingLogo(false);
      event.target.value = "";
    }
  }

  function removeLogo() {
    setForm((prev) => ({
      ...prev,
      logo_url: "",
    }));
  }

  async function handleSave(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setMessage("");
      setMessageType("info");

      const resolvedCompanyId = companyId;
      if (!resolvedCompanyId) {
        throw new Error("No se encontro la empresa activa.");
      }

      const payload = {
        company_id: resolvedCompanyId,
        business_name: form.business_name.trim(),
        legal_name: form.legal_name.trim(),
        rfc: form.rfc.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        website: form.website.trim(),
        logo_url: form.logo_url.trim(),
        signature_url: form.signature_url.trim(),
        primary_color: form.primary_color,
        secondary_color: form.secondary_color,
        pdf_footer: form.pdf_footer.trim(),
        default_terms: form.default_terms.trim(),
        default_notes: form.default_notes.trim(),
      };

      const { error } = await supabase
        .from("company_branding")
        .upsert(payload, { onConflict: "company_id" });

      if (error) throw error;

      const { error: companyError } = await supabase
        .from("companies")
        .update({
          name: payload.business_name || company?.name || "Tu empresa",
          logo_url: payload.logo_url || null,
          primary_color: payload.primary_color,
        })
        .eq("id", resolvedCompanyId);

      if (companyError) throw companyError;

      onBrandingSaved?.((previous) => ({
        ...previous,
        branding: {
          ...(previous?.branding || {}),
          ...payload,
        },
        company: {
          ...(previous?.company || company || {}),
          id: resolvedCompanyId,
          name: payload.business_name || previous?.company?.name || company?.name || "Tu empresa",
          logo_url: payload.logo_url || null,
          primary_color: payload.primary_color,
        },
        companyId: resolvedCompanyId,
      }));

      setMessageType("success");
      setMessage("Datos de empresa guardados correctamente.");
    } catch (error) {
      console.error(error);
      setMessageType("error");
      setMessage("Hubo un error al guardar la configuracion.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div>Cargando configuracion...</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Configuracion</h1>
        <p>Personaliza la identidad visual y los datos de tu empresa para cotizaciones, clientes y PDF.</p>
      </div>

      <form className="settings-shell" onSubmit={handleSave}>
        <section className="module-card settings-preview-card">
          <div className="settings-preview-head">
            <div>
              <h2 className="section-title">Vista previa</h2>
              <p className="section-copy">Asi se vera tu marca dentro del portal.</p>
            </div>
          </div>

          <div className="branding-preview" style={{ borderColor: form.primary_color }}>
            <div className="branding-preview-top">
              <div
                className="branding-logo-frame"
                style={{ borderColor: form.primary_color, backgroundColor: `${form.primary_color}12` }}
              >
                {form.logo_url ? (
                  <img src={form.logo_url} alt="Logo de la empresa" className="branding-logo-image" />
                ) : (
                  <span className="branding-logo-fallback">
                    {(form.business_name || "Tu empresa").slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>

              <div>
                <h3 className="branding-company-name">{form.business_name || "Tu empresa"}</h3>
                <p className="branding-company-meta">{form.legal_name || "Razon social"}</p>
                <p className="branding-company-meta">{form.email || currentUser?.email || "correo@empresa.com"}</p>
                <p className="branding-company-meta">{form.phone || "+52 000 000 0000"}</p>
              </div>
            </div>

            <div className="branding-preview-accent" style={{ background: form.primary_color }} />

            <div className="branding-preview-footer">
              <p><strong>RFC:</strong> {form.rfc || "Pendiente"}</p>
              <p><strong>Sitio:</strong> {form.website || "Pendiente"}</p>
              <p><strong>Direccion:</strong> {form.address || "Agrega la direccion de tu empresa"}</p>
            </div>
          </div>

          <div className="logo-tools">
            <div className="form-group form-group-full">
              <label>Subir logo</label>
              <input type="file" accept="image/*" onChange={handleLogoFileChange} disabled={uploadingLogo || saving} />
              <span className="section-copy">
                Usa JPG, PNG o SVG de hasta 2 MB. El archivo se guardara junto con la configuracion de tu empresa.
              </span>
            </div>

            <div className="settings-inline-actions">
              <button type="button" className="secondary-btn" onClick={removeLogo} disabled={!form.logo_url || saving}>
                Quitar logo
              </button>
            </div>
          </div>
        </section>

        <section className="module-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Datos de empresa</h2>
              <p className="section-copy">Estos datos identifican al negocio de cada usuario.</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Nombre comercial</label>
              <input name="business_name" value={form.business_name} onChange={handleChange} placeholder="Mi despacho / taller / estudio" />
            </div>

            <div className="form-group">
              <label>Razon social</label>
              <input name="legal_name" value={form.legal_name} onChange={handleChange} placeholder="Empresa S.A. de C.V." />
            </div>

            <div className="form-group">
              <label>RFC</label>
              <input name="rfc" value={form.rfc} onChange={handleChange} placeholder="XAXX010101000" />
            </div>

            <div className="form-group">
              <label>Telefono</label>
              <input name="phone" value={form.phone} onChange={handleChange} placeholder="+52 555 000 0000" />
            </div>

            <div className="form-group">
              <label>Correo</label>
              <input name="email" value={form.email} onChange={handleChange} placeholder="contacto@empresa.com" />
            </div>

            <div className="form-group">
              <label>Sitio web</label>
              <input name="website" value={form.website} onChange={handleChange} placeholder="https://miempresa.com" />
            </div>

            <div className="form-group form-group-full">
              <label>Direccion</label>
              <textarea name="address" value={form.address} onChange={handleChange} rows="3" placeholder="Calle, numero, colonia, ciudad" />
            </div>

            <div className="form-group form-group-full">
              <label>URL del logo</label>
              <input name="logo_url" value={form.logo_url} onChange={handleChange} placeholder="https://... o carga una imagen arriba" />
            </div>
          </div>
        </section>

        <section className="module-card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Personalizacion visual</h2>
              <p className="section-copy">Colores y textos por defecto para tus documentos.</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Color principal</label>
              <input type="color" name="primary_color" value={form.primary_color} onChange={handleChange} />
            </div>

            <div className="form-group">
              <label>Color secundario</label>
              <input type="color" name="secondary_color" value={form.secondary_color} onChange={handleChange} />
            </div>

            <div className="form-group form-group-full">
              <label>Pie de PDF</label>
              <textarea name="pdf_footer" value={form.pdf_footer} onChange={handleChange} rows="2" placeholder="Gracias por su preferencia" />
            </div>

            <div className="form-group form-group-full">
              <label>Terminos por defecto</label>
              <textarea name="default_terms" value={form.default_terms} onChange={handleChange} rows="3" placeholder="Tiempo de entrega, vigencia, forma de pago..." />
            </div>

            <div className="form-group form-group-full">
              <label>Notas por defecto</label>
              <textarea name="default_notes" value={form.default_notes} onChange={handleChange} rows="3" placeholder="Observaciones internas o aclaraciones al cliente" />
            </div>
          </div>

          <div className="settings-actions">
            <button type="submit" className="primary-btn" disabled={saving || uploadingLogo}>
              {saving ? "Guardando..." : "Guardar configuracion"}
            </button>
          </div>

          {message ? (
            <p className={`form-message ${messageType === "error" ? "form-message-error" : "form-message-success"}`}>
              {message}
            </p>
          ) : null}
        </section>
      </form>
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}
