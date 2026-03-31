import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function ClientesPage() {
  const [status, setStatus] = useState("Iniciando...");
  const [clientes, setClientes] = useState([]);

  useEffect(() => {
    test();
  }, []);

  async function test() {
    try {
      setStatus("1) Revisando sesión...");

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = sessionData.session?.user;
      if (!user) {
        setStatus("No hay sesión activa.");
        return;
      }

      setStatus(`2) Sesión OK: ${user.email}`);

      const { data: uc, error: ucError } = await supabase
        .from("user_companies")
        .select("company_id")
        .eq("user_id", user.id)
        .single();

      if (ucError) throw ucError;

      setStatus(`3) Company ID: ${uc.company_id}`);

      const { data, error } = await supabase
        .from("clientes")
        .select("id, tenant_id, nombre, email")
        .limit(20);

      if (error) throw error;

      setClientes(data || []);
      setStatus(`4) Clientes cargados: ${data?.length || 0}`);
    } catch (error) {
      console.error(error);
      setStatus(`ERROR: ${error.message}`);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Clientes</h1>
        <p>Diagnóstico de carga.</p>
      </div>

      <div className="module-card">
        <p><strong>Estado:</strong> {status}</p>

        {clientes.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Tenant</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id}>
                  <td>{c.nombre}</td>
                  <td>{c.email || "-"}</td>
                  <td>{c.tenant_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}