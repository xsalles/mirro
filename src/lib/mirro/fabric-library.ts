import type {
  FabricLibraryEntry,
  FabricPhysicalProfile,
} from "./types";

export const FABRIC_LIBRARY: FabricLibraryEntry[] = [
  {
    id: "cotton-jersey-160",
    name: "Malha de algodão",
    family: "Jersey",
    composition: "Algodão predominante",
    source: "engineering-preset",
    profile: {
      densityGsm: 160,
      thicknessMm: 0.7,
      stretchWarpPct: 7,
      stretchWeftPct: 18,
      bendStiffness: 42,
      friction: 0.24,
    },
    notes: "Preset de engenharia para camiseta de malha comum.",
  },
  {
    id: "poly-sport-140",
    name: "Dry fit / poliéster esportivo",
    family: "Knit",
    composition: "Poliéster predominante",
    source: "engineering-preset",
    profile: {
      densityGsm: 140,
      thicknessMm: 0.5,
      stretchWarpPct: 12,
      stretchWeftPct: 28,
      bendStiffness: 32,
      friction: 0.14,
    },
    notes: "Mais leve, liso e flexível que jersey de algodão.",
  },
  {
    id: "french-terry-280",
    name: "Moletom médio",
    family: "French terry",
    composition: "Algodão/poliéster",
    source: "engineering-preset",
    profile: {
      densityGsm: 280,
      thicknessMm: 1.25,
      stretchWarpPct: 7,
      stretchWeftPct: 13,
      bendStiffness: 70,
      friction: 0.3,
    },
    notes: "Preset para moletom sem felpa muito pesada.",
  },
  {
    id: "denim-12oz",
    name: "Jeans 12 oz",
    family: "Denim",
    composition: "Algodão predominante",
    source: "engineering-preset",
    profile: {
      densityGsm: 407,
      thicknessMm: 1.05,
      stretchWarpPct: 2,
      stretchWeftPct: 3,
      bendStiffness: 92,
      friction: 0.34,
    },
    notes: "Denim rígido; stretch jeans deve usar valores maiores de trama.",
  },
  {
    id: "linen-170",
    name: "Linho médio",
    family: "Woven",
    composition: "Linho predominante",
    source: "engineering-preset",
    profile: {
      densityGsm: 170,
      thicknessMm: 0.55,
      stretchWarpPct: 2,
      stretchWeftPct: 3,
      bendStiffness: 67,
      friction: 0.27,
    },
    notes: "Pouca elasticidade e dobra marcada.",
  },
  {
    id: "poly-satin-120",
    name: "Cetim leve",
    family: "Satin",
    composition: "Poliéster",
    source: "engineering-preset",
    profile: {
      densityGsm: 120,
      thicknessMm: 0.35,
      stretchWarpPct: 3,
      stretchWeftPct: 5,
      bendStiffness: 36,
      friction: 0.08,
    },
    notes: "Superfície lisa e baixo atrito; não representa brilho por si só.",
  },
];

export function getFabricLibraryEntry(id: string | undefined) {
  return FABRIC_LIBRARY.find((entry) => entry.id === id);
}

export function fabricProfileToForm(
  profile: FabricPhysicalProfile,
) {
  return Object.fromEntries(
    Object.entries(profile).map(([key, value]) => [key, String(value)]),
  ) as Record<keyof FabricPhysicalProfile, string>;
}
