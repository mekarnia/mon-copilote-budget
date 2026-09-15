/**
 * Jeu d'icônes au trait, grille de 24, épaisseur unique.
 * Remplace les emoji : recolorables, alignées entre elles, identiques sur tous les téléphones.
 */

type Props = { className?: string; size?: number };

function svg(path: JSX.Element) {
  return function Icon({ className = "", size = 20 }: Props) {
    return (
      <svg
        width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
        className={className} aria-hidden="true"
      >
        {path}
      </svg>
    );
  };
}

export const IconHouse = svg(<><path d="M3 10.5 12 3.5l9 7" /><path d="M5.5 9.5V20h13V9.5" /></>);
export const IconCart = svg(<><path d="M3 4h2l2.2 10.2a1.6 1.6 0 0 0 1.6 1.3h7.8a1.6 1.6 0 0 0 1.6-1.2L20 7H6" /><circle cx="9.5" cy="19.5" r="1.1" /><circle cx="17" cy="19.5" r="1.1" /></>);
export const IconChild = svg(<><circle cx="12" cy="7" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>);
export const IconCar = svg(<><path d="M4 16.5v2.2h3v-2.2" /><path d="M17 16.5v2.2h3v-2.2" /><path d="M3.5 16.5h17v-4l-1.8-4.4a1.6 1.6 0 0 0-1.5-1H6.8a1.6 1.6 0 0 0-1.5 1L3.5 12.5z" /><circle cx="7" cy="14" r="0.8" fill="currentColor" /><circle cx="17" cy="14" r="0.8" fill="currentColor" /></>);
export const IconPill = svg(<><rect x="2.8" y="8.5" width="18.4" height="7" rx="3.5" transform="rotate(-45 12 12)" /><path d="M9.2 9.2 14.8 14.8" /></>);
export const IconCup = svg(<><path d="M8 3.5v5a4 4 0 0 0 8 0v-5" /><path d="M12 12.5V20" /><path d="M8.5 20h7" /></>);
export const IconShirt = svg(<><path d="M9 3.5 5 5.5l1.2 4L8 9v11h8V9l1.8.5 1.2-4-4-2a3 3 0 0 1-6 0z" /></>);
export const IconBank = svg(<><path d="M3.5 9.5 12 4l8.5 5.5" /><path d="M5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7" /><path d="M3.5 20h17" /></>);
export const IconArrowUp = svg(<><path d="M12 20V5" /><path d="M6 11l6-6 6 6" /></>);
export const IconSwap = svg(<><path d="M4 8.5h13l-3-3" /><path d="M20 15.5H7l3 3" /></>);
export const IconScale = svg(<><path d="M12 4.5v15" /><path d="M6 8h12" /><path d="M6 8 3.5 14h5z" /><path d="M18 8l-2.5 6h5z" /></>);
export const IconTag = svg(<><path d="M4 4.5h7l9 9-6.5 6.5-9-9z" /><circle cx="8" cy="8.5" r="1.3" /></>);

export const IconReceipt = svg(<><path d="M5 4.5h14v15l-2.3-1.5-2.4 1.5-2.3-1.5-2.4 1.5L7.3 18 5 19.5z" /><path d="M9 9h6M9 13h4" /></>);
export const IconTarget = svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v8.5h8.5" /></>);
export const IconFlag = svg(<><path d="M6 21V4.5" /><path d="M6 5h11l-2.2 3.6L17 12H6" /></>);
export const IconChart = svg(<><path d="M3 16.5l5-5.5 3.5 3L21 5.5" /><path d="M21 10.5v-5h-5" /></>);
export const IconBars = svg(<><path d="M4 19V10" /><path d="M10 19V5" /><path d="M16 19v-6" /><path d="M22 19H2" /></>);
export const IconGear = svg(<><path d="M4 7h11M19 7h1M4 17h3M11 17h9" /><circle cx="17" cy="7" r="2.4" /><circle cx="9" cy="17" r="2.4" /></>);
export const IconPlus = svg(<path d="M12 5.5v13M5.5 12h13" />);
export const IconLeft = svg(<path d="M14.5 5.5 8 12l6.5 6.5" />);
export const IconRight = svg(<path d="M9.5 5.5 16 12l-6.5 6.5" />);
export const IconDown = svg(<path d="M5.5 9.5 12 16l6.5-6.5" />);
export const IconSearch = svg(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>);
export const IconWarning = svg(<><path d="M12 8.5v4.5" /><circle cx="12" cy="16.4" r="0.7" fill="currentColor" /><path d="M10.6 4.2 2.9 18a1.6 1.6 0 0 0 1.4 2.4h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 4.2a1.6 1.6 0 0 0-2.8 0z" /></>);
export const IconChat = svg(<><path d="M21 12a8 8 0 1 1-3.3-6.5" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.1 3.2c-.6.3-.9.8-.9 1.4v.5" /><circle cx="11.8" cy="17.4" r="0.6" fill="currentColor" /></>);
export const IconCard = svg(<><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /></>);
export const IconCash = svg(<><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /></>);
export const IconRobot = svg(<><path d="M12 3.5v3" /><rect x="4.5" y="6.5" width="15" height="12" rx="3" /><circle cx="9.5" cy="12.5" r="1.1" fill="currentColor" /><circle cx="14.5" cy="12.5" r="1.1" fill="currentColor" /></>);

/** Teinte tenue d'un écran à l'autre : la même catégorie garde sa couleur partout. */
export interface CategoryLook {
  Icon: (p: Props) => JSX.Element;
  /** fond de la pastille */ bg: string;
  /** couleur du trait */ fg: string;
  /** couleur de la barre de proportion */ bar: string;
}

const LOOKS: Record<string, CategoryLook> = {
  Maison: { Icon: IconHouse, bg: "bg-brand/10", fg: "text-brand", bar: "bg-brand" },
  Courses: { Icon: IconCart, bg: "bg-amber-100 dark:bg-amber-950", fg: "text-amber-700 dark:text-amber-300", bar: "bg-amber-600" },
  Enfants: { Icon: IconChild, bg: "bg-pink-100 dark:bg-pink-950", fg: "text-pink-700 dark:text-pink-300", bar: "bg-pink-600" },
  Transport: { Icon: IconCar, bg: "bg-sky-100 dark:bg-sky-950", fg: "text-sky-700 dark:text-sky-300", bar: "bg-sky-600" },
  "Santé": { Icon: IconPill, bg: "bg-emerald-100 dark:bg-emerald-950", fg: "text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-600" },
  "Sorties et loisirs": { Icon: IconCup, bg: "bg-violet-100 dark:bg-violet-950", fg: "text-violet-700 dark:text-violet-300", bar: "bg-violet-600" },
  Perso: { Icon: IconShirt, bg: "bg-rose-100 dark:bg-rose-950", fg: "text-rose-700 dark:text-rose-300", bar: "bg-rose-600" },
  "Banque et impôts": { Icon: IconBank, bg: "bg-slate-200 dark:bg-slate-800", fg: "text-slate-700 dark:text-slate-300", bar: "bg-slate-600" },
  Revenus: { Icon: IconArrowUp, bg: "bg-brand/10", fg: "text-brand", bar: "bg-brand" },
  "Virement interne": { Icon: IconSwap, bg: "bg-slate-200 dark:bg-slate-800", fg: "text-slate-600 dark:text-slate-400", bar: "bg-slate-500" },
  "Ajustement de solde": { Icon: IconScale, bg: "bg-slate-200 dark:bg-slate-800", fg: "text-slate-600 dark:text-slate-400", bar: "bg-slate-500" },
};

const DEFAUT: CategoryLook = { Icon: IconTag, bg: "bg-slate-200 dark:bg-slate-800", fg: "text-slate-600 dark:text-slate-400", bar: "bg-slate-500" };

/** Apparence d'une catégorie, cherchée sur la catégorie principale puis sur elle-même. */
export function categoryLook(name?: string | null, parentName?: string | null): CategoryLook {
  return LOOKS[parentName ?? ""] ?? LOOKS[name ?? ""] ?? DEFAUT;
}

/** Pastille carrée d'une catégorie, telle qu'elle apparaît dans toutes les listes. */
export function CategoryBadge({ name, parentName, size = 38 }: { name?: string | null; parentName?: string | null; size?: number }) {
  const look = categoryLook(name, parentName);
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl ${look.bg} ${look.fg}`} style={{ width: size, height: size }}>
      <look.Icon size={Math.round(size * 0.5)} />
    </span>
  );
}
