# MIRRO fabric datasheet import

MIRRO v14 can fill garment-physics parameters from a local manufacturer/lab datasheet without uploading the source file.

## Supported files

The browser importer accepts a single file up to 256 KB:

- JSON (`.json`)
- CSV (`.csv`)
- TSV (`.tsv`)
- plain text (`.txt`)

PDF/OCR extraction is intentionally not claimed in v14. Export/copy the relevant table to one of the supported text formats when the original datasheet is a PDF.

The raw source file is read only in the browser and is not persisted. MIRRO stores derived values plus source provenance: file name, parser version, source format and SHA-256.

## Canonical parameters

MIRRO recognizes these six physical parameters:

| MIRRO field | Meaning | Accepted range |
| --- | --- | --- |
| `densityGsm` | areal density / gramatura | 40–1000 g/m² |
| `thicknessMm` | fabric thickness | 0.1–5 mm |
| `stretchWarpPct` | warp-direction stretch | 0–45% |
| `stretchWeftPct` | weft-direction stretch | 0–45% |
| `bendStiffness` | normalized MIRRO bend stiffness | 0–100 |
| `friction` | cloth friction coefficient | 0.02–0.8 |

Density accepts g/m²/gsm directly and converts oz/yd² to g/m². Thickness accepts mm directly and converts cm, micrometers/microns and inches to mm.

Bend stiffness is a MIRRO-normalized 0–100 input. V14 does **not** invent a conversion from arbitrary Kawabata/cantilever/flexural units into that normalized scale. If a source sheet does not explicitly provide a compatible normalized value, leave that field manual.

## JSON example

```json
{
  "reference": "LAB-2026-041",
  "testedAt": "2026-09-18",
  "profile": {
    "densityGsm": "185 gsm",
    "thicknessMm": "0.72 mm",
    "stretchWarpPct": "8%",
    "stretchWeftPct": "18%",
    "bendStiffness": 46,
    "friction": 0.21
  }
}
```

The parser also accepts arrays of `{ "parameter": "...", "value": "..." }` rows.

## CSV example

Wide form:

```csv
reference,densityGsm,thicknessMm,stretchWarpPct,stretchWeftPct,bendStiffness,friction
MFR-900,155,0.55,4,9,39,0.16
```

Pair form:

```csv
parameter;value
gramatura;210 gsm
espessura;0,85 mm
stretch urdume;7%
stretch trama;12%
rigidez dobra;61
atrito;0,31
```

Semicolon-separated CSV is useful when decimal commas are used.

## TXT example

```text
Referência: TEC-77
Data do ensaio: 21/09/2026
Gramatura: 6 oz/yd²
Espessura: 650 microns
Elasticidade urdume: 5%
Elasticidade trama: 14%
Rigidez de dobra: 52
Coeficiente de atrito: 0,28
```

Aliases are normalized for capitalization, punctuation and common Portuguese/English names such as gramatura/GSM/areal density, urdume/warp and trama/weft.

## Validation behavior

Import is transactional at the parser level:

- an unrecognized field is ignored;
- a recognized field with an unreadable or out-of-range value rejects the import instead of silently clamping it;
- a partial but valid sheet can be applied;
- fields not found in a partial sheet keep the values already present in the form;
- reference/date metadata are optional during parsing, but a garment saved as `lab-sheet` still requires a visible reference in the form.

The same numeric limits are shared by imported data and manual garment-physics validation.

## Field-level provenance

An imported sheet does not automatically make all six solver values “measured”.

MIRRO persists `measuredFields` for the exact physical fields still linked to the imported source. If the user manually edits one imported field after import, that field is removed from `measuredFields` while the other imported fields retain their provenance.

For imported sheets, `FabricEvidence.importedFrom` stores:

- source file name;
- source format;
- SHA-256 of the source bytes;
- parser version.

The SHA-256 supports source identity/reproducibility; it is not a cryptographic signature and does not prove that the manufacturer/lab itself is trustworthy.

## Privacy and storage

All parsing and hashing run locally in the browser. The raw datasheet is not uploaded and is not stored in IndexedDB by v14. Only the garment's derived physics values and provenance metadata are persisted.
