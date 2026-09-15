// Dinar algérien : « 1 234,56 DA ». Les montants sont stockés en centimes (1 DA = 100 centimes).
const fmt = new Intl.NumberFormat("fr-DZ", { style: "currency", currency: "DZD" });
export const CURRENCY_SYMBOL = "DA";

const fmtCourt = new Intl.NumberFormat("fr-DZ", { style: "currency", currency: "DZD", maximumFractionDigits: 0 });

/** Montant arrondi au dinar, pour les emplacements étroits (pastilles, listes denses). */
export function formatCentsShort(cents: number): string {
  return fmtCourt.format(cents / 100);
}

export function formatCents(cents: number): string {
  return fmt.format(cents / 100);
}

/** "12,50" | "12.5" | "1 250" -> 1250 centimes. Retourne null si illisible. */
export function parseEuros(input: string): number | null {
  const cleaned = input.replace(/\s|\u00a0/g, "").replace(/DA|DZD|€/gi, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
