const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export function formatCents(cents: number): string {
  return fmt.format(cents / 100);
}

/** "12,50" | "12.5" | "1 250" -> 1250 centimes. Retourne null si illisible. */
export function parseEuros(input: string): number | null {
  const cleaned = input.replace(/\s/g, "").replace(/€/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
