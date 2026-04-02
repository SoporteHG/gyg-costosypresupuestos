import { supabase } from "./supabase";

const ADMIN_REQUEST_TIMEOUT_MS = 3500;
const FALLBACK_SUPER_ADMIN_EMAIL = "soportedvr07@gmail.com";
export const PRESENCE_HEARTBEAT_MS = 60000;

async function withTimeout(promise, label) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`Tiempo de espera agotado en ${label}.`));
    }, ADMIN_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function getAdminContext(user) {
  const email = user?.email?.trim().toLowerCase() || "";
  const isFallbackAdmin = email === FALLBACK_SUPER_ADMIN_EMAIL;

  if (!user?.id) {
    return {
      isSuperAdmin: false,
      role: "user",
      source: "none",
    };
  }

  try {
    const { data, error } = await withTimeout(
      supabase
        .from("platform_admins")
        .select("role, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
      "consultar platform_admins"
    );

    if (error) {
      throw error;
    }

    const isSuperAdmin = data?.role === "super_admin" || isFallbackAdmin;

    return {
      isSuperAdmin,
      role: data?.role || (isFallbackAdmin ? "super_admin" : "user"),
      source: data?.role ? "table" : isFallbackAdmin ? "fallback-email" : "none",
    };
  } catch (error) {
    if (isFallbackAdmin) {
      return {
        isSuperAdmin: true,
        role: "super_admin",
        source: "fallback-email",
      };
    }

    return {
      isSuperAdmin: false,
      role: "user",
      source: "none",
      error: error.message || "No se pudo validar el rol administrativo.",
    };
  }
}

export async function logPlatformAccess({ user, company }) {
  if (!user?.id) {
    return;
  }

  try {
    await supabase.from("access_audit_logs").insert({
      user_id: user.id,
      user_email: user.email || "",
      company_id: company?.id || null,
      company_name: company?.name || "",
      event_type: "login",
      metadata: {
        source: window.location.origin,
      },
    });
  } catch (_error) {
    // El log es auxiliar; no debe bloquear el acceso si la tabla aun no existe.
  }
}

export async function touchUserPresence({ user, company }) {
  if (!user?.id || !company?.id) {
    return;
  }

  try {
    await supabase.rpc("record_user_presence", {
      p_user_id: user.id,
      p_user_email: user.email || "",
      p_company_id: company.id,
      p_company_name: company.name || "",
      p_activity_date: getLocalDateStamp(),
      p_current_path: window.location.pathname || "/",
      p_seen_at: new Date().toISOString(),
    });
  } catch (_error) {
    // La presencia es auxiliar; no debe bloquear la experiencia si aun no existe el SQL.
  }
}

export async function markUserPresenceOffline({ user, company }) {
  if (!user?.id || !company?.id) {
    return;
  }

  try {
    await supabase
      .from("live_user_presence")
      .update({
        is_online: false,
        last_seen_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("company_id", company.id);
  } catch (_error) {
    // No bloquea cierre de sesion o navegacion.
  }
}

function getLocalDateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
