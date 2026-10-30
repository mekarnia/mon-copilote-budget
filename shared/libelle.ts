/**
 * Normalise un libellé bancaire : minuscules, sans accents, sans ponctuation.
 * Les nombres isolés disparaissent — ce sont des dates et des références de
 * transaction, qui changent à chaque passage du même commerçant. Les chiffres
 * collés à des lettres restent : « M6 », « B2B » ou « 5asec » font partie du nom.
 */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(cb|carte|paiement|prlv|prelevement|vir|virement|sepa|facture|achat)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
