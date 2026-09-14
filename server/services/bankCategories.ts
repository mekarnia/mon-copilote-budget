import type { Category, TxType } from "../../shared/types.js";

// La plupart des banques françaises exportent déjà deux colonnes de classement
// (« Catégorie » et « Sous-catégorie »). Les traduire ici évite d'appeler l'IA
// pour la quasi-totalité des lignes d'un relevé.

/** Minuscules, sans accent ni ponctuation : « Achat multimédia, high-tech » -> « achat multimedia high tech ». */
export function normalizeCategoryLabel(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

interface BankRule {
  kind: TxType;
  re: RegExp;
  /** Catégorie principale de l'application. */
  parent: string;
  /** Sous-catégorie, ou null pour rester sur la catégorie principale. */
  child: string | null;
}

// L'ordre compte : la première règle qui correspond gagne, donc du plus précis au plus général.
const RULES: BankRule[] = [
  // Maison
  { kind: "expense", re: /loyer|credit immobilier|credit logement|immobilier/, parent: "Maison", child: "Loyer ou crédit" },
  { kind: "expense", re: /electricite|\bgaz\b|energie|\bedf\b|engie/, parent: "Maison", child: "Électricité et gaz" },
  { kind: "expense", re: /\beau\b|assainissement/, parent: "Maison", child: "Eau" },
  { kind: "expense", re: /telephon|mobile|internet|\bbox\b|fibre|adsl|forfait/, parent: "Maison", child: "Internet et téléphone" },
  { kind: "expense", re: /assurance habitation|assurance logement/, parent: "Maison", child: "Assurance habitation" },
  { kind: "expense", re: /travaux|bricolage|jardin|ameublement|meuble|decoration|entretien maison/, parent: "Maison", child: "Entretien et travaux" },
  { kind: "expense", re: /logement|habitation|copropriete|syndic|charges/, parent: "Maison", child: null },

  // Courses
  { kind: "expense", re: /supermarche|hypermarche|grande surface|courses|alimentation|alimentaire|epicerie|\bdrive\b/, parent: "Courses", child: "Supermarché" },
  { kind: "expense", re: /boulangerie|patisserie/, parent: "Courses", child: "Boulangerie" },
  { kind: "expense", re: /marche|primeur|boucherie|poissonnerie/, parent: "Courses", child: "Marché" },

  // Enfants
  { kind: "expense", re: /cantine|scolaire|scolarite|ecole|college|lycee|universite|etudes/, parent: "Enfants", child: "École et cantine" },
  { kind: "expense", re: /creche|garde|nounou|assistante maternelle|periscolaire/, parent: "Enfants", child: "Garde" },
  { kind: "expense", re: /jouet/, parent: "Enfants", child: "Jouets et cadeaux" },
  { kind: "expense", re: /enfant|bebe|puericulture/, parent: "Enfants", child: null },

  // Transport
  { kind: "expense", re: /carburant|essence|gazole|diesel|station service/, parent: "Transport", child: "Carburant" },
  { kind: "expense", re: /peage|autoroute|parking|stationnement/, parent: "Transport", child: "Parking et péage" },
  { kind: "expense", re: /assurance auto|assurance vehicule|assurance voiture|garage|reparation auto|entretien vehicule|controle technique|pneu/, parent: "Transport", child: "Entretien et assurance voiture" },
  { kind: "expense", re: /train|sncf|ratp|metro|\bbus\b|tramway|transport en commun|taxi|\bvtc\b|covoiturage|navigo/, parent: "Transport", child: "Transports en commun" },
  { kind: "expense", re: /\bauto\b|voiture|vehicule|transport|deplacement|mobilite/, parent: "Transport", child: null },

  // Santé
  { kind: "expense", re: /mutuelle|complementaire sante/, parent: "Santé", child: "Mutuelle" },
  { kind: "expense", re: /optique|opticien|lunette|dentaire|dentiste|orthodontie/, parent: "Santé", child: "Optique et dentaire" },
  { kind: "expense", re: /pharmacie|medecin|medical|docteur|hopital|clinique|laboratoire|infirmier|\bkine\b/, parent: "Santé", child: "Médecin et pharmacie" },
  { kind: "expense", re: /sante|\bsoin\b/, parent: "Santé", child: null },

  // Sorties et loisirs
  { kind: "expense", re: /restaurant|restauration|brasserie|\bbar\b|\bbars\b|\bcafe\b|fast food|traiteur|\bsnack\b/, parent: "Sorties et loisirs", child: "Restaurant" },
  { kind: "expense", re: /vacances|voyage|hotel|sejour|camping|billet avion|aerien/, parent: "Sorties et loisirs", child: "Vacances" },
  { kind: "expense", re: /\bsport\b|fitness|salle de sport|piscine/, parent: "Sorties et loisirs", child: "Sport" },
  { kind: "expense", re: /abonnement|streaming|presse|musique/, parent: "Sorties et loisirs", child: "Abonnements" },
  { kind: "expense", re: /cinema|spectacle|concert|musee|theatre|sortie|loisir|culture|\blivre\b|jeu video|divertissement/, parent: "Sorties et loisirs", child: "Sorties" },

  // Perso
  { kind: "expense", re: /vetement|habillement|chaussure|\bmode\b|pret a porter/, parent: "Perso", child: "Vêtements" },
  { kind: "expense", re: /beaute|coiffeur|coiffure|esthetique|parfum|cosmetique/, parent: "Perso", child: "Beauté et coiffeur" },
  { kind: "expense", re: /shopping|achats|\bachat\b|multimedia|high tech|electromenager|informatique|cadeau|vie quotidienne|quotidien|divers/, parent: "Perso", child: "Divers" },

  // Banque et impôts
  { kind: "expense", re: /impot|\btaxe|tresor public|\bfisc\b|urssaf|amende|contravention/, parent: "Banque et impôts", child: "Impôts" },
  { kind: "expense", re: /^banque( autres)?$|banque autres/, parent: "Banque et impôts", child: null },
  { kind: "expense", re: /frais bancaire|tenue de compte|agios|commission|cotisation carte|\bfrais\b|\bbanque\b/, parent: "Banque et impôts", child: "Frais bancaires" },
  { kind: "expense", re: /assurance|prevoyance|obseques/, parent: "Banque et impôts", child: "Assurances autres" },

  // Revenus
  { kind: "income", re: /salaire|\bpaie\b|\bpaye\b|remuneration|traitement|revenus d activite/, parent: "Revenus", child: "Salaire" },
  { kind: "income", re: /\bcaf\b|allocation|\baide\b|\bapl\b|prestation|pension|retraite|chomage|pole emploi|france travail|\bbourse\b/, parent: "Revenus", child: "Aides (CAF, APL)" },
  { kind: "income", re: /remboursement|ristourne|\bavoir\b|\bcpam\b|securite sociale/, parent: "Revenus", child: "Remboursements" },
  { kind: "income", re: /revenu|virement|interet|dividende|vente|\bautres\b/, parent: "Revenus", child: "Autres revenus" },
];

/** Identifiant de la catégorie de l'application portant ce nom, ou de sa catégorie principale à défaut. */
function resolve(categories: Category[], parentName: string, childName: string | null): number | null {
  const parent = categories.find((c) => c.parentId === null && !c.technicalKey && normalizeCategoryLabel(c.name) === normalizeCategoryLabel(parentName));
  if (!parent) return null;
  if (!childName) return parent.id;
  const child = categories.find((c) => c.parentId === parent.id && normalizeCategoryLabel(c.name) === normalizeCategoryLabel(childName));
  return child ? child.id : parent.id;
}

/**
 * Traduit le classement de la banque en catégorie de l'application, sans IA.
 * La sous-catégorie est examinée en premier car elle est plus précise.
 * `kind` empêche qu'une dépense atterrisse dans une catégorie de revenu, et inversement.
 */
export function matchBankCategory(categories: Category[], kind: TxType, bankCategory: string, bankSubCategory: string): number | null {
  if (kind !== "expense" && kind !== "income") return null;
  for (const text of [bankSubCategory, bankCategory]) {
    const t = normalizeCategoryLabel(text ?? "");
    if (!t) continue;
    for (const rule of RULES) {
      if (rule.kind !== kind || !rule.re.test(t)) continue;
      const id = resolve(categories, rule.parent, rule.child);
      if (id !== null) return id;
    }
  }
  return null;
}
