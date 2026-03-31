import { supabase } from "./supabase";

const COMPANY_REQUEST_TIMEOUT_MS = 4000;
const COMPANY_CACHE_PREFIX = "gyg-company-context:";

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

export async function getCurrentCompanyContext(userId) {
  if (!userId) {
    throw new Error("No hay usuario autenticado.");
  }

  const cachedContext = readCachedCompanyContext(userId);

  let companyLinks = null;
  let linksError = null;

  try {
    const response = await withTimeout(
      supabase
        .from("user_companies")
        .select("company_id, role")
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

  const ownerLink =
    companyLinks?.find((item) => item.role === "owner") ||
    companyLinks?.[0] ||
    null;

  if (!ownerLink?.company_id) {
    throw new Error("No se encontro una empresa propia para este usuario.");
  }

  const { data: company, error: companyError } = await withTimeout(
    supabase
      .from("companies")
      .select("id, name, slug, business_type, logo_url, primary_color, status")
      .eq("id", ownerLink.company_id)
      .maybeSingle(),
    "consultar companies"
  );

  if (companyError) {
    throw companyError;
  }

  if (!company?.id) {
    throw new Error("No se pudo cargar la empresa activa.");
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
  };

  writeCachedCompanyContext(userId, context);

  return context;
}

function getCompanyCacheKey(userId) {
  return `${COMPANY_CACHE_PREFIX}${userId}`;
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
