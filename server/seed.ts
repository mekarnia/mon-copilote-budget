export interface SeedGroup {
  name: string;
  kind: "expense" | "income" | "technical";
  icon: string;
  key?: "transfer" | "adjustment";
  children: string[];
}

export const SEED_CATEGORIES: SeedGroup[] = [
  { name: "Maison", kind: "expense", icon: "🏠", children: ["Loyer ou crédit", "Électricité et gaz", "Eau", "Internet et téléphone", "Assurance habitation", "Entretien et travaux"] },
  { name: "Courses", kind: "expense", icon: "🛒", children: ["Supermarché", "Boulangerie", "Marché"] },
  { name: "Enfants", kind: "expense", icon: "🧒", children: ["École et cantine", "Garde", "Activités", "Vêtements", "Jouets et cadeaux"] },
  { name: "Transport", kind: "expense", icon: "🚗", children: ["Carburant", "Transports en commun", "Entretien et assurance voiture", "Parking et péage"] },
  { name: "Santé", kind: "expense", icon: "💊", children: ["Médecin et pharmacie", "Mutuelle", "Optique et dentaire"] },
  { name: "Sorties et loisirs", kind: "expense", icon: "🎉", children: ["Restaurant", "Sorties", "Abonnements", "Vacances", "Sport"] },
  { name: "Perso", kind: "expense", icon: "👕", children: ["Vêtements", "Beauté et coiffeur", "Divers"] },
  { name: "Banque et impôts", kind: "expense", icon: "🏦", children: ["Impôts", "Frais bancaires", "Assurances autres"] },
  { name: "Revenus", kind: "income", icon: "💶", children: ["Salaire", "Aides (CAF, APL)", "Remboursements", "Autres revenus"] },
  { name: "Virement interne", kind: "technical", icon: "🔁", key: "transfer", children: [] },
  { name: "Ajustement de solde", kind: "technical", icon: "⚖️", key: "adjustment", children: [] },
];
