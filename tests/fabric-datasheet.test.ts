import { describe, expect, it } from "vitest";
import {
  parseFabricDatasheet,
  validateFabricPhysicalProfile,
} from "../src/lib/mirro/fabric-datasheet";

describe("fabric datasheet parser", () => {
  it("parses a nested JSON lab sheet with reference metadata", () => {
    const result = parseFabricDatasheet(
      JSON.stringify({
        reference: "LAB-2026-041",
        testedAt: "2026-09-18",
        profile: {
          densityGsm: "185 gsm",
          thicknessMm: "0.72 mm",
          stretchWarpPct: "8%",
          stretchWeftPct: "18%",
          bendStiffness: 46,
          friction: 0.21,
        },
      }),
      "json",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.reference).toBe(
      "LAB-2026-041",
    );
    expect(result.data.testedAt).toBe(
      "2026-09-18",
    );
    expect(result.data.recognizedFields).toHaveLength(
      6,
    );
    expect(result.data.profile).toEqual({
      densityGsm: 185,
      thicknessMm: 0.72,
      stretchWarpPct: 8,
      stretchWeftPct: 18,
      bendStiffness: 46,
      friction: 0.21,
    });
    expect(result.data.warnings).toEqual([]);
  });

  it("parses Portuguese TXT aliases and unit conversions", () => {
    const result = parseFabricDatasheet(
      [
        "Referência: TEC-77",
        "Data do ensaio: 21/09/2026",
        "Gramatura: 6 oz/yd²",
        "Espessura: 650 microns",
        "Elasticidade urdume: 5%",
        "Elasticidade trama: 14%",
        "Rigidez de dobra: 52",
        "Coeficiente de atrito: 0,28",
      ].join("\n"),
      "text",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.reference).toBe("TEC-77");
    expect(result.data.testedAt).toBe(
      "2026-09-21",
    );
    expect(
      result.data.profile.densityGsm,
    ).toBeCloseTo(203.4345, 3);
    expect(
      result.data.profile.thicknessMm,
    ).toBeCloseTo(0.65, 6);
    expect(result.data.profile.friction).toBe(
      0.28,
    );
  });

  it("parses a semicolon CSV with decimal commas", () => {
    const result = parseFabricDatasheet(
      [
        "parâmetro;valor",
        "gramatura;210 gsm",
        "espessura;0,85 mm",
        "stretch urdume;7%",
        "stretch trama;12%",
        "rigidez dobra;61",
        "atrito;0,31",
      ].join("\n"),
      "csv",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.profile).toEqual({
      densityGsm: 210,
      thicknessMm: 0.85,
      stretchWarpPct: 7,
      stretchWeftPct: 12,
      bendStiffness: 61,
      friction: 0.31,
    });
  });

  it("supports a wide CSV header row", () => {
    const result = parseFabricDatasheet(
      [
        "reference,densityGsm,thicknessMm,stretchWarpPct,stretchWeftPct,bendStiffness,friction",
        "MFR-900,155,0.55,4,9,39,0.16",
      ].join("\n"),
      "csv",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.reference).toBe("MFR-900");
    expect(result.data.recognizedFields).toHaveLength(
      6,
    );
  });

  it("keeps partial sheets usable and reports fields that remain manual", () => {
    const result = parseFabricDatasheet(
      [
        "Gramatura: 170 gsm",
        "Espessura: 0.6 mm",
        "Referência: fabricante-X",
      ].join("\n"),
      "text",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.recognizedFields).toEqual([
      "densityGsm",
      "thicknessMm",
    ]);
    expect(result.data.warnings.join(" ")).toContain(
      "4 campo(s)",
    );
  });

  it("refuses recognized values outside MIRRO physical limits", () => {
    const result = parseFabricDatasheet(
      [
        "Gramatura: 1500 gsm",
        "Espessura: 0.7 mm",
      ].join("\n"),
      "text",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors.join(" ")).toContain(
      "Gramatura",
    );
  });

  it("refuses files that contain no compatible physical parameters", () => {
    const result = parseFabricDatasheet(
      "Composição: 100% algodão\nCor: azul",
      "text",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors.join(" ")).toContain(
      "Nenhum parâmetro físico",
    );
  });

  it("shares the same limits with manual physical-profile validation", () => {
    expect(
      validateFabricPhysicalProfile({
        densityGsm: 160,
        thicknessMm: 0.7,
        stretchWarpPct: 7,
        stretchWeftPct: 18,
        bendStiffness: 42,
        friction: 0.24,
      }),
    ).toEqual({});

    expect(
      validateFabricPhysicalProfile({
        densityGsm: 39,
        thicknessMm: 5.1,
        stretchWarpPct: 46,
        stretchWeftPct: -1,
        bendStiffness: 101,
        friction: 0.81,
      }),
    ).toEqual(
      expect.objectContaining({
        densityGsm: expect.any(String),
        thicknessMm: expect.any(String),
        stretchWarpPct: expect.any(String),
        stretchWeftPct: expect.any(String),
        bendStiffness: expect.any(String),
        friction: expect.any(String),
      }),
    );
  });
});
