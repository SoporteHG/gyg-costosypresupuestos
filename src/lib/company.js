import { supabase } from "./supabase";

const COMPANY_REQUEST_TIMEOUT_MS = 4000;
const COMPANY_CACHE_PREFIX = "gyg-company-context:";
const ACTIVE_COMPANY_PREFIX = "gyg-active-company:";

async function withTimeout(promise, label) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`Tiempo de espera agotado en ${label}.`));
    }, COMPANY_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function getCurrentCompanyContext(userId, preferredCompanyId = null) {
  if (!userId) {
    throw new Error("No hay usuario autenticado.");
  }

  const cachedContext = readCachedCompanyContext(userId);
  const storedActiveCompanyId = preferredCompanyId || readStoredActiveCompanyId(userId) || cachedContext?.companyId || null;

  let companyLinks = null;
  let linksError = null;

  try {
    const response = await withTimeout(
      supabase
        .from("user_companies")
        .select("company_id, role, status, is_default")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
      "consultar user_companies"
    );

    companyLinks = response.data;
    linksError = response.error;
  } catch (error) {
    if (cachedContext?.companyId) {
      return cachedContext;
    }

    throw error;
  }

  if (linksError) {
    if (cachedContext?.companyId) {
      return cachedContext;
    }

    throw linksError;
  }

  const normalizedLinks = (companyLinks || []).filter((item) => item?.company_id);
  if (!normalizedLinks.length) {
    throw new Error("No se encontro una empresa propia para este usuario.");
  }

  const companyIds = normalizedLinks.map((item) => item.company_id);

  const { data: companies, error: companiesError } = await withTimeout(
    supabase
      .from("companies")
      .select("id, name, slug, business_type, logo_url, primary_color, status")
      .in("id", companyIds),
    "consultar companies"
  );

  if (companiesError) {
    throw companiesError;
  }

  const companiesById = new Map((companies || []).map((entry) => [entry.id, entry]));
  const availableCompanies = normalizedLinks
    .map((link) => {
      const company = companiesById.get(link.company_id);
      if (!company?.id) return null;

      return {
        id: company.id,
        name: company.name,
        slug: company.slug,
        business_type: company.business_type,
        logo_url: company.logo_url,
        primary_color: company.primary_color,
        status: company.status,
        role: link.role || "user",
        membership_status: link.status || "active",
        is_default: !!link.is_default,
      };
    })
    .filter(Boolean);

  if (!availableCompanies.length) {
    throw new Error("No se pudo cargar la empresa activa.");
  }

  const activeCompanies = availableCompanies.filter(
    (entry) =>
      String(entry.membership_status || "active").toLowerCase() === "active" &&
      String(entry.status || "active").toLowerCase() !== "suspended" &&
      String(entry.status || "active").toLowerCase() !== "expired"
  );

  const selectedCompany =
    activeCompanies.find((entry) => entry.id === storedActiveCompanyId) ||
    activeCompanies.find((entry) => entry.is_default) ||
    activeCompanies.find((entry) => entry.role === "owner") ||
    activeCompanies[0] ||
    availableCompanies.find((entry) => entry.id === storedActiveCompanyId) ||
    availableCompanies.find((entry) => entry.is_default) ||
    availableCompanies.find((entry) => entry.role === "owner") ||
    availableCompanies[0] ||
    null;

  const company = selectedCompany;

  const normalizedStatus = String(company.status || "active").toLowerCase();
  if (normalizedStatus === "suspended") {
    throw new Error("Tu empresa se encuentra suspendida. Contacta al administrador del sistema.");
  }

  if (normalizedStatus === "expired") {
    throw new Error("Tu acceso ha vencido. Contacta al administrador para renovar tu plan.");
  }

  const { data: branding, error: brandingError } = await withTimeout(
    supabase
      .from("company_branding")
      .select("*")
      .eq("company_id", company.id)
      .maybeSingle(),
    "consultar company_branding"
  );

  if (brandingError) {
    throw brandingError;
  }

  const context = {
    companyId: company.id,
    company,
    branding: branding || null,
    availableCompanies,
  };

  writeCachedCompanyContext(userId, context);
  writeStoredActiveCompanyId(userId, company.id);

  return context;
}

function getCompanyCacheKey(userId) {
  return `${COMPANY_CACHE_PREFIX}${userId}`;
}

function getActiveCompanyKey(userId) {
  return `${ACTIVE_COMPANY_PREFIX}${userId}`;
}

function readCachedCompanyContext(userId) {
  try {
    const rawValue = window.localStorage.getItem(getCompanyCacheKey(userId));
    if (!rawValue) return null;

    const parsed = JSON.parse(rawValue);
    if (!parsed?.companyId || !parsed?.company) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.error("No se pudo leer el cache de empresa:", error);
    return null;
  }
}

function writeCachedCompanyContext(userId, context) {
  try {
    window.localStorage.setItem(getCompanyCacheKey(userId), JSON.stringify(context));
  } catch (error) {
    console.error("No se pudo guardar el cache de empresa:", error);
  }
}

function readStoredActiveCompanyId(userId) {
  try {
    return window.localStorage.getItem(getActiveCompanyKey(userId));
  } catch (error) {
    console.error("No se pudo leer la empresa activa guardada:", error);
    return null;
  }
}

function writeStoredActiveCompanyId(userId, companyId) {
  try {
    window.localStorage.setItem(getActiveCompanyKey(userId), companyId);
  } catch (error) {
    console.error("No se pudo guardar la empresa activa:", error);
  }
}

export function clearStoredCompanyContext(userId) {
  try {
    window.localStorage.removeItem(getCompanyCacheKey(userId));
    window.localStorage.removeItem(getActiveCompanyKey(userId));
  } catch (error) {
    console.error("No se pudo limpiar el contexto de empresa:", error);
  }
}
