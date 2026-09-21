"use client";

import Image from "next/image";
import Link from "next/link";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ClothSimulationPreview } from "@/components/cloth-simulation-preview";
import { useMirro } from "@/components/mirro-provider";
import { Button } from "@/components/ui/button";
import { loadMedia } from "@/lib/mirro/db";
import { fitGarment } from "@/lib/mirro/fit";
import { calibrateGarmentFromProcessedImages } from "@/lib/mirro/garment-image-processing";
import { buildGarmentMesh, clothMaterialForGarment } from "@/lib/mirro/garment-mesh";
import { simulateClothStep } from "@/lib/mirro/xpbd";
import type { ClothMaterial, Garment, GarmentMesh } from "@/lib/mirro/types";

type PreviewMode = "physics" | "photo";
type SimulationStatus = "idle" | "preparing" | "simulating" | "ready" | "error";

type SimulationData = {
  mesh: GarmentMesh;
  material: ClothMaterial;
  calibrationScore: number;
  collisions: number;
};

function useMediaUrl(key?: string) {
  const [media, setMedia] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!key) return;

    let active = true;
    let objectUrl: string | null = null;

    loadMedia(key).then((blob) => {
      if (!blob || !active) return;
      objectUrl = URL.createObjectURL(blob);
      setMedia({ key, url: objectUrl });
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key]);

  return media && media.key === key ? media.url : null;
}

export default function TryOnPage() {
  const { state } = useMirro();
  const profile = state.profile;
  const bodyMesh = profile?.calibration?.mesh;
  const [selectedId, setSelectedId] = useState(state.garments[0]?.id ?? "");
  const [mode, setMode] = useState<PreviewMode>("physics");
  const [adjust, setAdjust] = useState({ scale: 1, x: 0, y: 0 });
  const [yaw, setYaw] = useState(18);
  const [simulationStatus, setSimulationStatus] = useState<SimulationStatus>("idle");
  const [simulationData, setSimulationData] = useState<SimulationData | null>(null);
  const [simulationProgress, setSimulationProgress] = useState(0);
  const [simulationError, setSimulationError] = useState("");
  const [revision, setRevision] = useState(0);
  const [rerun, setRerun] = useState(0);

  const garment: Garment | undefined = useMemo(
    () => state.garments.find((item) => item.id === selectedId) ?? state.garments[0],
    [state.garments, selectedId],
  );

  const bodyUrl = useMediaUrl(profile?.photos.front?.key);
  const garmentUrl = useMediaUrl(garment?.images.front.key);
  const fit = profile && garment ? fitGarment(profile, garment.category, 1) : null;

  useEffect(() => {
    if (!bodyMesh || !garment || mode !== "physics") {
      setSimulationStatus("idle");
      return;
    }

    let active = true;
    let animationFrame = 0;

    async function prepare() {
      setSimulationStatus("preparing");
      setSimulationProgress(0);
      setSimulationError("");
      setSimulationData(null);

      let calibration = garment.calibration;
      if (!calibration) {
        const [frontBlob, backBlob] = await Promise.all([
          loadMedia(garment.images.front.key),
          loadMedia(garment.images.back.key),
        ]);
        if (!frontBlob || !backBlob) {
          throw new Error("As imagens desta peça não estão mais disponíveis neste navegador.");
        }
        calibration = await calibrateGarmentFromProcessedImages(frontBlob, backBlob);
      }

      if (!active) return;

      const mesh = buildGarmentMesh({
        garment,
        calibration,
        bodyMesh,
      });
      const material = clothMaterialForGarment(garment);
      const totalSteps = 144;
      const stepsPerFrame = 4;
      let currentStep = 0;
      let collisions = 0;

      setSimulationData({
        mesh,
        material,
        calibrationScore: calibration.quality.score,
        collisions: 0,
      });
      setRevision((value) => value + 1);
      setSimulationStatus("simulating");

      function tick() {
        if (!active) return;

        for (
          let localStep = 0;
          localStep < stepsPerFrame && currentStep < totalSteps;
          localStep += 1
        ) {
          const result = simulateClothStep({
            mesh,
            bodyMesh,
            material,
            dt: 1 / 60,
            iterations: 9,
          });
          collisions += result.collisions;
          currentStep += 1;
        }

        setSimulationProgress(currentStep / totalSteps);
        setRevision((value) => value + 1);

        if (currentStep < totalSteps) {
          animationFrame = requestAnimationFrame(tick);
          return;
        }

        setSimulationData({
          mesh,
          material,
          calibrationScore: calibration.quality.score,
          collisions,
        });
        setSimulationStatus("ready");
      }

      animationFrame = requestAnimationFrame(tick);
    }

    prepare().catch((error) => {
      if (!active) return;
      setSimulationStatus("error");
      setSimulationError(
        error instanceof Error
          ? error.message
          : "Não foi possível preparar a simulação física desta peça.",
      );
    });

    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
    };
  }, [bodyMesh, garment, mode, rerun]);

  if (!profile?.photos.front || !bodyMesh || state.garments.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-white p-8">
        <h1 className="font-display text-4xl font-bold tracking-[-.04em]">Experimentar</h1>
        <p className="mt-3 max-w-xl text-[var(--muted)]">
          Para abrir o provador, você precisa gerar o BodyMesh do corpo e cadastrar pelo menos uma peça.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            className="rounded-xl bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]"
            href="/app/body"
          >
            Calibrar corpo
          </Link>
          <Link
            className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)]"
            href="/app/wardrobe"
          >
            Cadastrar peça
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-[-.04em]">Experimentar</h1>
          <p className="mt-2 max-w-3xl text-[var(--muted)]">
            O modo físico cria dois painéis a partir da silhueta real da peça, costura a malha e resolve gravidade, elasticidade e colisão contra o BodyMesh.
          </p>
        </div>

        <div className="inline-flex self-start rounded-xl border border-[var(--line)] bg-white p-1" aria-label="Modo de visualização">
          <button
            type="button"
            aria-pressed={mode === "physics"}
            onClick={() => setMode("physics")}
            className={`min-h-10 cursor-pointer rounded-lg px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)] ${mode === "physics" ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-2)]"}`}
          >
            Físico 3D beta
          </button>
          <button
            type="button"
            aria-pressed={mode === "photo"}
            onClick={() => setMode("photo")}
            className={`min-h-10 cursor-pointer rounded-lg px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--thread)] ${mode === "photo" ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-2)]"}`}
          >
            Foto 2D
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section
          className="mx-auto w-full max-w-[680px] overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_24px_70px_rgba(17,19,24,.10)]"
          aria-label="Prévia do provador"
        >
          {mode === "physics" ? (
            simulationData ? (
              <ClothSimulationPreview
                bodyMesh={bodyMesh}
                garmentMesh={simulationData.mesh}
                revision={revision}
                yawDegrees={yaw}
              />
            ) : (
              <div className="grid aspect-[31/38] place-items-center bg-[var(--surface-2)] p-8 text-center">
                <div>
                  <p className="font-semibold">
                    {simulationStatus === "error" ? "A simulação física não abriu." : "Preparando GarmentMesh…"}
                  </p>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
                    {simulationStatus === "error"
                      ? simulationError
                      : "Lendo a forma da peça e montando os painéis de tecido localmente."}
                  </p>
                  {simulationStatus === "error" ? (
                    <Button className="mt-5" type="button" variant="secondary" onClick={() => setRerun((value) => value + 1)}>
                      Tentar novamente
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          ) : (
            <div className="relative aspect-[3/4] bg-[#e9ebf0]">
              {bodyUrl ? (
                <Image
                  src={bodyUrl}
                  alt="Foto frontal usada como base do provador"
                  fill
                  unoptimized
                  priority
                  sizes="(max-width: 1280px) 100vw, 680px"
                  className="object-cover"
                />
              ) : null}

              {garmentUrl && fit ? (
                <div
                  className="absolute origin-center"
                  style={{
                    left: `${fit.xPct + adjust.x}%`,
                    top: `${fit.yPct + adjust.y}%`,
                    width: `${fit.widthPct * adjust.scale}%`,
                    height: `${fit.heightPct * adjust.scale}%`,
                  }}
                >
                  <div className="relative size-full">
                    <Image
                      src={garmentUrl}
                      alt={`Simulação de ${garment?.name ?? "peça"}`}
                      fill
                      unoptimized
                      sizes="50vw"
                      className="object-contain"
                    />
                  </div>
                </div>
              ) : null}

              <div className="absolute bottom-4 left-4 rounded-xl bg-black/75 px-3 py-2 text-xs font-semibold text-white">
                fallback 2D · foto real
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <label htmlFor="garment" className="text-sm font-semibold">Peça</label>
            <select
              id="garment"
              className="mt-2"
              value={garment?.id ?? ""}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setAdjust({ scale: 1, x: 0, y: 0 });
              }}
            >
              {state.garments.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>

          {mode === "physics" ? (
            <>
              <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold">Simulação XPBD</h2>
                  <span className="text-xs font-semibold text-[var(--muted)]">
                    {simulationStatus === "ready"
                      ? "estabilizada"
                      : simulationStatus === "simulating"
                        ? "calculando"
                        : simulationStatus === "error"
                          ? "erro"
                          : "preparando"}
                  </span>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden="true">
                  <div
                    className="h-full bg-[var(--thread)] transition-[width] duration-150 motion-reduce:transition-none"
                    style={{ width: `${Math.round(simulationProgress * 100)}%` }}
                  />
                </div>
                <p role="status" aria-live="polite" className="mt-2 text-xs text-[var(--muted)]">
                  {simulationStatus === "simulating"
                    ? `${Math.round(simulationProgress * 100)}% dos passos físicos`
                    : simulationStatus === "ready"
                      ? "Tecido relaxado contra o BodyMesh."
                      : simulationStatus === "preparing"
                        ? "Construindo painéis, UV e costuras."
                        : ""}
                </p>

                {simulationData ? (
                  <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-[var(--muted)]">Partículas</dt>
                      <dd className="mt-1 font-bold tabular-nums">{simulationData.mesh.positions.length / 3}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--muted)]">Triângulos</dt>
                      <dd className="mt-1 font-bold tabular-nums">{simulationData.mesh.indices.length / 3}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--muted)]">Constraints</dt>
                      <dd className="mt-1 font-bold tabular-nums">{simulationData.mesh.constraints.length}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--muted)]">Forma</dt>
                      <dd className="mt-1 font-bold tabular-nums">{Math.round(simulationData.calibrationScore * 100)}%</dd>
                    </div>
                  </dl>
                ) : null}

                <Button
                  className="mt-5 w-full"
                  type="button"
                  variant="secondary"
                  disabled={simulationStatus === "preparing" || simulationStatus === "simulating"}
                  onClick={() => setRerun((value) => value + 1)}
                >
                  <RotateCcw size={16} aria-hidden="true" /> Re-simular
                </Button>
              </div>

              <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
                <label htmlFor="yaw" className="flex justify-between text-sm font-semibold">
                  <span>Girar preview</span>
                  <span className="tabular-nums text-[var(--muted)]">{yaw}°</span>
                </label>
                <input
                  id="yaw"
                  className="mt-3 w-full accent-[var(--thread)]"
                  type="range"
                  min="-55"
                  max="55"
                  step="1"
                  value={yaw}
                  onChange={(event) => setYaw(Number(event.target.value))}
                />

                {simulationData ? (
                  <div className="mt-5 border-t border-[var(--line)] pt-4 text-xs leading-5 text-[var(--muted)]">
                    <p>peso: <strong className="text-[var(--ink)]">{garment?.fabricWeight}</strong></p>
                    <p>elasticidade: <strong className="text-[var(--ink)]">{garment?.stretch}</strong></p>
                    <p>espessura de colisão: <strong className="text-[var(--ink)] tabular-nums">{simulationData.material.thicknessCm.toFixed(2)} cm</strong></p>
                    {simulationStatus === "ready" ? (
                      <p>contatos resolvidos: <strong className="text-[var(--ink)] tabular-nums">{simulationData.collisions.toLocaleString("pt-BR")}</strong></p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={18} aria-hidden="true" />
                <h2 className="font-semibold">Calibração 2D</h2>
              </div>
              <div className="mt-5 space-y-5">
                {([
                  ["scale", "Escala", 0.7, 1.3, 0.01, adjust.scale],
                  ["x", "Horizontal", -12, 12, 0.5, adjust.x],
                  ["y", "Vertical", -12, 12, 0.5, adjust.y],
                ] as const).map(([key, label, min, max, step, value]) => (
                  <div key={key}>
                    <div className="flex justify-between text-sm">
                      <label htmlFor={key} className="font-semibold">{label}</label>
                      <span className="tabular-nums text-[var(--muted)]">
                        {Number(value).toFixed(key === "scale" ? 2 : 1)}
                      </span>
                    </div>
                    <input
                      id={key}
                      className="mt-2 w-full accent-[var(--thread)]"
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={value}
                      onChange={(event) =>
                        setAdjust((previous) => ({
                          ...previous,
                          [key]: Number(event.target.value),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-[var(--thread-soft)] p-5 text-sm leading-6">
            <strong>Limite atual:</strong> o GarmentMesh já tem frente, costas, gola/ombros e costuras laterais, mas calças ainda usam um envelope único porque o BodyMesh v1 também não separa as duas pernas. Auto-colisão e textura deformada entram na próxima camada.
          </div>
        </aside>
      </div>
    </div>
  );
}
