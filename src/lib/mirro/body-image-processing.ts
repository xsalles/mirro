import { buildBodyCalibration, segmentBodySilhouette, type RgbaImage } from "./body-calibration";
import {
  applyMetricViewCalibration,
  detectBodyViewCalibration,
} from "./body-camera-calibration";
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
        const { silhouette } = segmentBodySilhouette(image);
        const calibratedSilhouette = applyMetricViewCalibration(
          silhouette,
          viewCalibration,
        );
        return [side, calibratedSilhouette] as const;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Não foi possível segmentar a imagem.";
        throw new Error(`${SIDE_LABELS[side]}: ${detail}`);
      }
    }),
  );

  const silhouettes = Object.fromEntries(entries) as Record<BodySide, BodySilhouette>;
  return buildBodyCalibration(silhouettes, measurements);
}
