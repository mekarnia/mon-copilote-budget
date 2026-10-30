import type { ImportColumnMapping, ImportPreviewRow } from "./types.js";

// Lecture d'un relevé bancaire CSV, sans base de données : partagé entre le
// serveur local et la version Supabase, qui lit le fichier dans le navigateur.

// ---------- Lecture du fichier ----------

export function detectDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = [";", ",", "\t", "|"].map((d) => ({ d, n: head.split(d).length }));
  return counts.sort((a, b) => b.n - a.n)[0].d;
}

/** Analyse CSV minimaliste avec guillemets, sans dépendance. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** "1 234,56" | "-12.50" | "12,50 DA" -> centimes. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s| /g, "").replace(/DA|DZD|€|EUR/gi, "");
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-+]/g, "");
  // Séparateur décimal : le dernier "," ou "." ; les autres sont des milliers.
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  const dec = Math.max(lastComma, lastDot);
  if (dec >= 0 && s.length - dec - 1 <= 2) {
    s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else s = s.replace(/[.,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}

export function parseDate(raw: string, format: ImportColumnMapping["dateFormat"]): string | null {
  const m = raw.trim().match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (format === "ymd") [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if (format === "mdy") [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function detectDateFormat(values: string[]): ImportColumnMapping["dateFormat"] {
  const v = values.filter((x) => /\d/.test(x));
  if (v.some((x) => /^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/.test(x))) return "ymd";
  const firsts = v.map((x) => Number(x.match(/^(\d{1,2})/)?.[1] ?? 0));
  if (firsts.some((n) => n > 12)) return "dmy";
  const seconds = v.map((x) => Number(x.match(/^\d{1,4}[\/\-.](\d{1,2})/)?.[1] ?? 0));
  if (seconds.some((n) => n > 12)) return "mdy";
  return "dmy";
}

const HEADER_HINTS = {
  date: /date|jour/i,
  label: /libell|label|description|intitul|détail|detail|motif|nom/i,
  amount: /^montant$|^amount$|somme|valeur/i,
  debit: /d[ée]bit|sortie/i,
  credit: /cr[ée]dit|entr[ée]e/i,
  subCategory: /sous[\s_-]*cat[ée]gorie/i,
  category: /cat[ée]gorie|rubrique/i,
};

/** Devine la correspondance des colonnes à partir de l'en-tête et du contenu. */
export function detectMapping(columns: string[], sample: string[][]): ImportColumnMapping {
  const find = (re: RegExp) => columns.findIndex((c) => re.test(c));
  let date = find(HEADER_HINTS.date);
  let label = find(HEADER_HINTS.label);
  let amount = find(HEADER_HINTS.amount);
  let debit = find(HEADER_HINTS.debit);
  let credit = find(HEADER_HINTS.credit);
  const subCategory = find(HEADER_HINTS.subCategory);
  const category = columns.findIndex((c, i) => i !== subCategory && HEADER_HINTS.category.test(c));
  const colValues = (i: number) => sample.map((r) => r[i] ?? "");
  if (date < 0) date = columns.findIndex((_, i) => colValues(i).filter(Boolean).every((v) => /^\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}/.test(v)));
  if (amount < 0 && debit < 0) {
    amount = columns.findIndex((_, i) => i !== date && colValues(i).filter(Boolean).every((v) => parseAmount(v) !== null));
  }
  if (label < 0) label = columns.findIndex((_, i) => i !== date && i !== amount && i !== debit && i !== credit && i !== category && i !== subCategory && colValues(i).some((v) => /[a-zA-Z]{3,}/.test(v)));
  if (debit >= 0 && credit < 0) credit = null as unknown as number;
  return {
    date: Math.max(0, date),
    label: Math.max(0, label),
    amount: amount >= 0 ? amount : null,
    debit: debit >= 0 ? debit : null,
    credit: credit !== null && credit >= 0 ? credit : null,
    category: category >= 0 ? category : null,
    subCategory: subCategory >= 0 ? subCategory : null,
    dateFormat: detectDateFormat(colValues(Math.max(0, date))),
  };
}

// ---------- Lignes ----------

export function applyMapping(rows: string[][], mapping: ImportColumnMapping): ImportPreviewRow[] {
  return rows.map((r) => {
    const date = parseDate(r[mapping.date] ?? "", mapping.dateFormat);
    const label = (r[mapping.label] ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    let amount: number | null = null;
    if (mapping.amount !== null) amount = parseAmount(r[mapping.amount] ?? "");
    else {
      const deb = mapping.debit !== null ? parseAmount(r[mapping.debit] ?? "") : null;
      const cred = mapping.credit !== null ? parseAmount(r[mapping.credit] ?? "") : null;
      if (deb !== null && deb !== 0) amount = -Math.abs(deb);
      else if (cred !== null && cred !== 0) amount = Math.abs(cred);
    }
    const error = !date ? "Date illisible" : amount === null || amount === 0 ? "Montant illisible" : null;
    const cell = (i: number | null) => (i === null ? "" : (r[i] ?? "").trim().slice(0, 80));
    return {
      date, label, amount, type: amount === null ? null : amount < 0 ? "expense" : "income", duplicate: false, error,
      bankCategory: cell(mapping.category), bankSubCategory: cell(mapping.subCategory), categorySource: null,
    };
  });
}

