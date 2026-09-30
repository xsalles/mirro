"use client";

import {
  Check,
  CircleAlert,
  FileText,
  Upload,
} from "lucide-react";
import { useState } from "react";
import {
  FABRIC_FIELD_LABELS,
  parseFabricDatasheet,
  type FabricDatasheetFormat,
  type FabricDatasheetImport,
} from "@/lib/mirro/fabric-datasheet";

const MAX_DATASHEET_BYTES = 256 * 1024;

export type AppliedFabricDatasheet =
  FabricDatasheetImport & {
    fileName: string;
    sha256: string;
  };

type FabricDatasheetImportProps = {
  current: AppliedFabricDatasheet | null;
  onImported: (
    imported: AppliedFabricDatasheet,
  ) => void;
};

function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0
    ? fileName.slice(dot + 1).toLowerCase()
    : "";
}

function formatFromFileName(
  fileName: string,
): FabricDatasheetFormat | null {
  const extension = extensionOf(fileName);
  if (extension === "json") return "json";
  if (
    extension === "csv" ||
    extension === "tsv"
  ) {
    return "csv";
  }
  if (extension === "txt") return "text";
  return null;
}

async function sha256Hex(file: File) {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      "Este navegador não oferece SHA-256 local para registrar a origem da ficha.",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) =>
      byte.toString(16).padStart(2, "0"),
    )
    .join("");
}

export function FabricDatasheetImport({
  current,
  onImported,
}: FabricDatasheetImportProps) {
  const [status, setStatus] = useState<
    "idle" | "reading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  async function select(file?: File) {
    if (!file) return;

    const format = formatFromFileName(file.name);
    if (!format) {
      setStatus("error");
      setMessage(
        "Use uma ficha em JSON, CSV, TSV ou TXT.",
      );
      return;
    }
    if (
      file.size <= 0 ||
      file.size > MAX_DATASHEET_BYTES
    ) {
      setStatus("error");
      setMessage(
        "A ficha deve ter conteúdo e no máximo 256 KB.",
      );
      return;
    }

    setStatus("reading");
    setMessage("");

    try {
      const [text, sha256] = await Promise.all([
        file.text(),
        sha256Hex(file),
      ]);
      const parsed = parseFabricDatasheet(
        text,
        format,
      );

      if (!parsed.ok) {
        setStatus("error");
        setMessage(
          [...parsed.errors, ...parsed.warnings].join(
            " ",
          ),
        );
        return;
      }

      const imported: AppliedFabricDatasheet = {
        ...parsed.data,
        fileName: file.name,
        sha256,
      };
      setStatus("success");
      setMessage(
        `${imported.recognizedFields.length}/6 parâmetros reconhecidos e prontos para revisão.`,
      );
      onImported(imported);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível ler a ficha neste navegador.",
      );
    }
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileText
              size={17}
              aria-hidden="true"
              className="text-[var(--thread)]"
            />
            <p className="text-sm font-bold">
              Importar ficha técnica
            </p>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">
            Processamento 100% local. Aceita JSON,
            CSV/TSV e TXT com pares
            parâmetro/valor. A MIRRO registra somente
            os valores reconhecidos e o hash SHA-256
            da origem — o arquivo bruto não é salvo.
          </p>
        </div>

        <label className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[var(--surface-2)] focus-within:ring-2 focus-within:ring-[var(--thread)] focus-within:ring-offset-2">
          <Upload size={16} aria-hidden="true" />
          {current
            ? "Trocar ficha"
            : "Escolher ficha"}
          <input
            className="sr-only"
            type="file"
            accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/tab-separated-values,text/plain"
            aria-describedby="fabric-datasheet-help fabric-datasheet-status"
            onChange={(event) => {
              void select(
                event.target.files?.[0],
              );
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      <p
        id="fabric-datasheet-help"
        className="mt-2 text-[11px] leading-5 text-[var(--muted)]"
      >
        Máximo 256 KB. Unidades reconhecidas incluem
        g/m², gsm, oz/yd², mm, cm, µm e polegadas.
      </p>

      <div
        id="fabric-datasheet-status"
        aria-live="polite"
        className="mt-3"
      >
        {status === "reading" ? (
          <p className="text-xs font-semibold text-[var(--muted)]">
            Lendo, validando e calculando o hash
            local…
          </p>
        ) : null}

        {status === "error" ? (
          <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-xs leading-5 text-[var(--danger)]">
            <CircleAlert
              size={16}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <span>{message}</span>
          </div>
        ) : null}

        {status === "success" && current ? (
          <div className="rounded-xl bg-emerald-50/70 p-3">
            <div className="flex gap-2 text-xs leading-5">
              <Check
                size={16}
                className="mt-0.5 shrink-0 text-emerald-800"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold text-emerald-900">
                  {current.fileName} · {message}
                </p>
                <p className="mt-1 break-all text-[11px] text-[var(--muted)]">
                  SHA-256{" "}
                  {current.sha256.slice(0, 16)}…
                  · parser v
                  {current.parserVersion}
                </p>
                <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
                  Importados:{" "}
                  {current.recognizedFields
                    .map(
                      (field) =>
                        FABRIC_FIELD_LABELS[field],
                    )
                    .join(", ")}
                  .
                </p>
                {current.warnings.length ? (
                  <ul className="mt-2 space-y-1 text-[11px] leading-5 text-[var(--muted)]">
                    {current.warnings.map(
                      (warning) => (
                        <li key={warning}>
                          {warning}
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
