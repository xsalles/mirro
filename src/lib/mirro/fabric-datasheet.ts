import type {
  FabricPhysicalProfile,
} from "./types";

export const FABRIC_PROFILE_FIELDS = [
  "densityGsm",
  "thicknessMm",
  "stretchWarpPct",
  "stretchWeftPct",
  "bendStiffness",
  "friction",
] as const satisfies ReadonlyArray<
  keyof FabricPhysicalProfile
>;

export type FabricProfileField =
  (typeof FABRIC_PROFILE_FIELDS)[number];

export type FabricDatasheetFormat =
  | "json"
  | "csv"
  | "text";

export const FABRIC_FIELD_LABELS: Record<
  FabricProfileField,
  string
> = {
  densityGsm: "Gramatura",
  thicknessMm: "Espessura",
  stretchWarpPct: "Stretch urdume",
  stretchWeftPct: "Stretch trama",
  bendStiffness: "Rigidez de dobra",
  friction: "Atrito",
};

export const FABRIC_PHYSICAL_LIMITS: Record<
  FabricProfileField,
  { min: number; max: number; unit: string }
> = {
  densityGsm: {
    min: 40,
    max: 1000,
    unit: "g/m²",
  },
  thicknessMm: {
    min: 0.1,
    max: 5,
    unit: "mm",
  },
  stretchWarpPct: {
    min: 0,
    max: 45,
    unit: "%",
  },
  stretchWeftPct: {
    min: 0,
    max: 45,
    unit: "%",
  },
  bendStiffness: {
    min: 0,
    max: 100,
    unit: "/100",
  },
  friction: {
    min: 0.02,
    max: 0.8,
    unit: "",
  },
};

export type FabricDatasheetImport = {
  version: 1;
  parserVersion: 1;
  format: FabricDatasheetFormat;
  reference?: string;
  testedAt?: string;
  profile: Partial<FabricPhysicalProfile>;
  recognizedFields: FabricProfileField[];
  warnings: string[];
};

export type FabricDatasheetParseResult =
  | {
      ok: true;
      data: FabricDatasheetImport;
    }
  | {
      ok: false;
      errors: string[];
      warnings: string[];
    };

type RecordEntry = {
  key: string;
  value: unknown;
};

const FIELD_ALIASES: Record<
  FabricProfileField,
  string[]
> = {
  densityGsm: [
    "densitygsm",
    "density gsm",
    "gsm",
    "gramatura",
    "peso por area",
    "massa por area",
    "areal density",
    "fabric weight",
    "weight gsm",
  ],
  thicknessMm: [
    "thicknessmm",
    "thickness mm",
    "thickness",
    "espessura",
    "espessura mm",
  ],
  stretchWarpPct: [
    "stretchwarppct",
    "stretch warp pct",
    "stretch warp",
    "warp stretch",
    "warp elongation",
    "alongamento urdume",
    "elasticidade urdume",
    "stretch urdume",
  ],
  stretchWeftPct: [
    "stretchweftpct",
    "stretch weft pct",
    "stretch weft",
    "weft stretch",
    "weft elongation",
    "alongamento trama",
    "elasticidade trama",
    "stretch trama",
  ],
  bendStiffness: [
    "bendstiffness",
    "bend stiffness",
    "bending stiffness",
    "rigidez dobra",
    "rigidez de dobra",
    "rigidez flexao",
    "mirro bend stiffness",
  ],
  friction: [
    "friction",
    "friction coefficient",
    "coefficient friction",
    "coeficiente atrito",
    "coeficiente de atrito",
    "atrito",
  ],
};

const REFERENCE_ALIASES = [
  "reference",
  "reference id",
  "report",
  "report id",
  "document",
  "document id",
  "referencia",
  "referencia da ficha",
  "relatorio",
  "laudo",
  "codigo",
];

const TESTED_AT_ALIASES = [
  "testedat",
  "tested at",
  "test date",
  "date",
  "data",
  "data ensaio",
  "data do ensaio",
];

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/²/g, "2")
    .replace(/[_./\\-]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function keyMatches(
  normalizedKey: string,
  alias: string,
) {
  return (
    normalizedKey === alias ||
    normalizedKey.endsWith(` ${alias}`)
  );
}

function findField(
  key: string,
): FabricProfileField | undefined {
  const normalized = normalizeKey(key);
  return FABRIC_PROFILE_FIELDS.find((field) =>
    FIELD_ALIASES[field].some((alias) =>
      keyMatches(normalized, alias),
    ),
  );
}

function findMetadata(
  key: string,
): "reference" | "testedAt" | undefined {
  const normalized = normalizeKey(key);
  if (
    REFERENCE_ALIASES.some((alias) =>
      keyMatches(normalized, alias),
    )
  ) {
    return "reference";
  }
  if (
    TESTED_AT_ALIASES.some((alias) =>
      keyMatches(normalized, alias),
    )
  ) {
    return "testedAt";
  }
  return undefined;
}

function localizedNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : undefined;
  }
  if (typeof value !== "string") return undefined;

  const match = value
    .replace(/\u00a0/g, " ")
    .match(/[-+]?\d+(?:[.,]\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rounded(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function parsePhysicalValue(
  field: FabricProfileField,
  raw: unknown,
) {
  const number = localizedNumber(raw);
  if (number === undefined) return undefined;
  const text =
    typeof raw === "string"
      ? normalizeKey(raw)
      : "";

  if (field === "densityGsm") {
    if (/\boz\b/.test(text) && /(yd|yard)/.test(text)) {
      return rounded(number * 33.905747);
    }
    if (/\bkg\b/.test(text)) {
      return rounded(number * 1000);
    }
    return number;
  }

  if (field === "thicknessMm") {
    if (
      /(micron|microm|um\b)/.test(text)
    ) {
      return rounded(number * 0.001);
    }
    if (/\bcm\b/.test(text)) {
      return rounded(number * 10);
    }
    if (
      /(inch|inches|\bin\b)/.test(text)
    ) {
      return rounded(number * 25.4);
    }
    return number;
  }

  return number;
}

export function validateFabricPhysicalValue(
  field: FabricProfileField,
  value: number,
) {
  const limit = FABRIC_PHYSICAL_LIMITS[field];
  if (!Number.isFinite(value)) {
    return `${FABRIC_FIELD_LABELS[field]} precisa ser um número válido.`;
  }
  if (value < limit.min || value > limit.max) {
    return `${FABRIC_FIELD_LABELS[field]} deve ficar entre ${limit.min} e ${limit.max}${limit.unit ? ` ${limit.unit}` : ""}.`;
  }
  return null;
}

export function validateFabricPhysicalProfile(
  profile: FabricPhysicalProfile,
) {
  const errors: Partial<
    Record<FabricProfileField, string>
  > = {};
  for (const field of FABRIC_PROFILE_FIELDS) {
    const error = validateFabricPhysicalValue(
      field,
      profile[field],
    );
    if (error) errors[field] = error;
  }
  return errors;
}

function normalizeDate(raw: unknown) {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value) return undefined;

  const iso = value.match(
    /^(\d{4})-(\d{2})-(\d{2})$/,
  );
  if (iso) {
    const [, year, month, day] = iso;
    return validDateParts(year, month, day)
      ? `${year}-${month}-${day}`
      : undefined;
  }

  const br = value.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/,
  );
  if (!br) return undefined;
  const [, dayRaw, monthRaw, year] = br;
  const day = dayRaw.padStart(2, "0");
  const month = monthRaw.padStart(2, "0");
  return validDateParts(year, month, day)
    ? `${year}-${month}-${day}`
    : undefined;
}

function validDateParts(
  year: string,
  month: string,
  day: string,
) {
  const date = new Date(
    `${year}-${month}-${day}T00:00:00Z`,
  );
  return (
    !Number.isNaN(date.valueOf()) &&
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day)
  );
}

function flattenJson(
  value: unknown,
  prefix = "",
  output: RecordEntry[] = [],
): RecordEntry[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (
        item &&
        typeof item === "object" &&
        !Array.isArray(item)
      ) {
        const record = item as Record<string, unknown>;
        const key =
          record.parameter ??
          record.param ??
          record.key ??
          record.name;
        if (
          typeof key === "string" &&
          "value" in record
        ) {
          output.push({
            key,
            value: record.value,
          });
        } else {
          flattenJson(item, prefix, output);
        }
      }
    }
    return output;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const next = prefix
        ? `${prefix}.${key}`
        : key;
      flattenJson(child, next, output);
    }
    return output;
  }

  if (prefix) {
    output.push({ key: prefix, value });
  }
  return output;
}

function parseDelimitedLine(
  line: string,
  delimiter: string,
) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (
        quoted &&
        line[index + 1] === '"'
      ) {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function recordsFromCsv(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const sample = lines.slice(0, 4).join("\n");
  const delimiter = sample.includes(";")
    ? ";"
    : sample.includes("\t")
      ? "\t"
      : ",";

  const rows = lines.map((line) =>
    parseDelimitedLine(line, delimiter),
  );
  const header = rows[0] ?? [];
  const headerKnown = header.filter(
    (cell) =>
      Boolean(findField(cell)) ||
      Boolean(findMetadata(cell)),
  );

  if (headerKnown.length >= 2 && rows[1]) {
    const output: RecordEntry[] = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      for (
        let column = 0;
        column < header.length;
        column += 1
      ) {
        if (row[column] !== undefined) {
          output.push({
            key: header[column],
            value: row[column],
          });
        }
      }
    }
    return output;
  }

  const output: RecordEntry[] = [];
  for (const row of rows) {
    if (row.length < 2) continue;
    const first = normalizeKey(row[0]);
    if (
      ["parameter", "parametro", "field", "campo"].includes(
        first,
      )
    ) {
      continue;
    }
    output.push({
      key: row[0],
      value: row.slice(1).join(delimiter),
    });
  }
  return output;
}

function recordsFromText(text: string) {
  const output: RecordEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(
      /^(.+?)\s*[:=]\s*(.+)$/,
    );
    if (match) {
      output.push({
        key: match[1],
        value: match[2],
      });
      continue;
    }

    const delimiter = line.includes("\t")
      ? "\t"
      : line.includes(";")
        ? ";"
        : null;
    if (delimiter) {
      const cells = parseDelimitedLine(
        line,
        delimiter,
      );
      if (cells.length >= 2) {
        output.push({
          key: cells[0],
          value: cells.slice(1).join(delimiter),
        });
      }
    }
  }
  return output;
}

function detectFormat(
  text: string,
  hint?: FabricDatasheetFormat,
): FabricDatasheetFormat {
  if (hint) return hint;
  const trimmed = text.trim();
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    return "json";
  }
  const firstLines = trimmed
    .split(/\r?\n/)
    .slice(0, 3)
    .join("\n");
  if (
    firstLines.includes(";") ||
    firstLines.includes("\t") ||
    firstLines.split(",").length >= 3
  ) {
    return "csv";
  }
  return "text";
}

export function parseFabricDatasheet(
  text: string,
  hint?: FabricDatasheetFormat,
): FabricDatasheetParseResult {
  if (!text.trim()) {
    return {
      ok: false,
      errors: ["A ficha está vazia."],
      warnings: [],
    };
  }

  const format = detectFormat(text, hint);
  let records: RecordEntry[] = [];

  try {
    if (format === "json") {
      records = flattenJson(JSON.parse(text));
    } else if (format === "csv") {
      records = recordsFromCsv(text);
    } else {
      records = recordsFromText(text);
    }
  } catch {
    return {
      ok: false,
      errors: [
        "Não foi possível interpretar a estrutura da ficha.",
      ],
      warnings: [],
    };
  }

  const profile: Partial<FabricPhysicalProfile> = {};
  const recognizedFields: FabricProfileField[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let reference: string | undefined;
  let testedAt: string | undefined;

  for (const record of records) {
    const field = findField(record.key);
    if (field) {
      const parsed = parsePhysicalValue(
        field,
        record.value,
      );
      if (parsed === undefined) {
        errors.push(
          `${FABRIC_FIELD_LABELS[field]} foi encontrada, mas o valor não pôde ser convertido.`,
        );
        continue;
      }
      const validation =
        validateFabricPhysicalValue(
          field,
          parsed,
        );
      if (validation) {
        errors.push(validation);
        continue;
      }
      if (profile[field] !== undefined) {
        warnings.push(
          `${FABRIC_FIELD_LABELS[field]} apareceu mais de uma vez; o último valor válido foi usado.`,
        );
      }
      profile[field] = parsed;
      if (!recognizedFields.includes(field)) {
        recognizedFields.push(field);
      }
      continue;
    }

    const metadata = findMetadata(record.key);
    if (metadata === "reference") {
      const value = String(record.value ?? "").trim();
      if (value) reference = value;
    } else if (metadata === "testedAt") {
      const normalized = normalizeDate(
        String(record.value ?? ""),
      );
      if (normalized) {
        testedAt = normalized;
      } else if (
        String(record.value ?? "").trim()
      ) {
        warnings.push(
          "A data do ensaio não foi reconhecida e não será preenchida automaticamente.",
        );
      }
    }
  }

  if (!recognizedFields.length) {
    errors.push(
      "Nenhum parâmetro físico compatível com a MIRRO foi encontrado.",
    );
  }

  const missing = FABRIC_PROFILE_FIELDS.filter(
    (field) => !recognizedFields.includes(field),
  );
  if (missing.length) {
    warnings.push(
      `${missing.length} campo(s) não foram encontrados na ficha: ${missing
        .map((field) => FABRIC_FIELD_LABELS[field])
        .join(", ")}. Os valores atuais serão mantidos nesses campos.`,
    );
  }

  if (errors.length) {
    return {
      ok: false,
      errors,
      warnings,
    };
  }

  return {
    ok: true,
    data: {
      version: 1,
      parserVersion: 1,
      format,
      reference,
      testedAt,
      profile,
      recognizedFields,
      warnings,
    },
  };
}
