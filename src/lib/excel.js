import * as XLSX from "xlsx";

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export async function readExcelRows(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return [];
  }

  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });
}

export function mapExcelRows(rows, headerMap) {
  return rows.map((row) => {
    const normalizedEntries = Object.entries(row).reduce((accumulator, [key, value]) => {
      accumulator[normalizeHeader(key)] = value;
      return accumulator;
    }, {});

    return Object.entries(headerMap).reduce((accumulator, [field, aliases]) => {
      const resolvedValue = aliases
        .map((alias) => normalizedEntries[normalizeHeader(alias)])
        .find((value) => value !== undefined);

      accumulator[field] = resolvedValue ?? "";
      return accumulator;
    }, {});
  });
}

export function downloadExcelTemplate(filename, sheetName, rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}

export function normalizeText(value) {
  return String(value || "").trim();
}

export function normalizeLookupKey(parts) {
  return parts
    .map((part) => normalizeText(part).toLowerCase())
    .join("|");
}
