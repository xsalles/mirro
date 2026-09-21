import { buildBodyCalibration, segmentBodySilhouette, type RgbaImage } from "./body-calibration";
import type { BodyCalibration, BodyMeasurements, BodySide, BodySilhouette } from "./types";

const MAX_PROCESSING_SIDE = 900;

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
      const image = await decodeForCalibration(blob);
      const { silhouette } = segmentBodySilhouette(image);
      return [side, silhouette] as const;
    }),
  );

  const silhouettes = Object.fromEntries(entries) as Record<BodySide, BodySilhouette>;
  return buildBodyCalibration(silhouettes, measurements);
}
