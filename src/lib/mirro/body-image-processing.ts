import { buildBodyCalibration, segmentBodySilhouette, type RgbaImage } from "./body-calibration";
import {
  applyMetricViewCalibration,
  detectBodyViewCalibration,
} from "./body-camera-calibration";
import {
  rectifySilhouetteWithPinhole,
  solveBodyCameraRig,
} from "./camera-rig";
import { analyzeBodyTextureCalibration } from "./body-texture-calibration";
import type { BodyCalibration, BodyMeasurements, BodySide, BodySilhouette } from "./types";

const MAX_PROCESSING_SIDE = 900;

const SIDE_LABELS: Record<BodySide, string> = {
  front: "frente",
  right: "lateral direita",
  back: "costas",
  left: "lateral esquerda",
};

async function decodeForCalibration(blob: Blob): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_PROCESSING_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("O navegador não disponibilizou o Canvas 2D.");

    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    return {
      width,
      height,
      data: image.data,
    };
  } finally {
    bitmap.close();
  }
}

export async function calibrateBodyFromPhotos(
  photos: Record<BodySide, Blob>,
  measurements: BodyMeasurements,
): Promise<BodyCalibration> {
  const entries = await Promise.all(
    (Object.entries(photos) as Array<[BodySide, Blob]>).map(async ([side, blob]) => {
      try {
        const image = await decodeForCalibration(blob);
        const viewCalibration = detectBodyViewCalibration(image);
        const segmented = segmentBodySilhouette(image);
        const calibratedSilhouette = applyMetricViewCalibration(
          segmented.silhouette,
          viewCalibration,
        );
        return {
          side,
          image,
          mask: segmented.mask,
          silhouette: calibratedSilhouette,
          viewCalibration,
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Não foi possível segmentar a imagem.";
        throw new Error(`${SIDE_LABELS[side]}: ${detail}`);
      }
    }),
  );

  const silhouettes = Object.fromEntries(
    entries.map((entry) => [entry.side, entry.silhouette]),
  ) as Record<BodySide, BodySilhouette>;
  const images = Object.fromEntries(
    entries.map((entry) => [entry.side, entry.image]),
  ) as Record<BodySide, RgbaImage>;
  const masks = Object.fromEntries(
    entries.map((entry) => [entry.side, entry.mask]),
  ) as Record<BodySide, Uint8Array>;

  const textureCalibration = analyzeBodyTextureCalibration({
    images,
    masks,
    silhouettes,
  });

  const viewEntries = entries.filter(
    (entry): entry is typeof entry & { viewCalibration: NonNullable<typeof entry.viewCalibration> } =>
      Boolean(entry.viewCalibration),
  );

  let cameraRig;
  let calibratedViews:
    | Record<BodySide, NonNullable<(typeof entries)[number]["viewCalibration"]>>
    | undefined;

  if (viewEntries.length === 4) {
    const sourceViews = Object.fromEntries(
      viewEntries.map((entry) => [entry.side, entry.viewCalibration]),
    ) as Record<BodySide, NonNullable<(typeof entries)[number]["viewCalibration"]>>;

    try {
      const solved = solveBodyCameraRig(sourceViews);
      cameraRig = solved.rig;
      calibratedViews = solved.calibrations;

      for (const side of Object.keys(silhouettes) as BodySide[]) {
        silhouettes[side] = rectifySilhouetteWithPinhole(
          silhouettes[side],
          calibratedViews[side],
        );
      }
    } catch {
      // The metric v3 path remains valid if the shared pinhole solve is
      // numerically degenerate (for example, four nearly frontal targets).
    }
  }

  const base = buildBodyCalibration(silhouettes, measurements);

  if (!cameraRig || !calibratedViews) {
    return {
      ...base,
      textureCalibration,
    };
  }

  const warnings = [
    ...base.quality.warnings,
    ...cameraRig.warnings,
  ];

  return {
    ...base,
    version: 4,
    method: "pinhole-bundle-anatomical-v4",
    viewCalibration: calibratedViews,
    cameraRig,
    textureCalibration,
    quality: {
      ...base.quality,
      score: Math.min(
        1,
        base.quality.score * 0.72 +
          Math.max(0, 1 - cameraRig.rmsReprojectionErrorPx / 5) * 0.18 +
          textureCalibration.score * 0.1,
      ),
      warnings: [...new Set(warnings)],
    },
  };
}
