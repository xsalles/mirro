import { analyzeAlphaSilhouette, buildGarmentCalibration } from "./garment-calibration";
import type { GarmentCalibration } from "./types";

const MAX_SIDE = 900;

async function decodeAlpha(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("O navegador não disponibilizou o Canvas 2D.");

    context.drawImage(bitmap, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);

    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = data[index * 4 + 3];
    }

    return { width, height, alpha };
  } finally {
    bitmap.close();
  }
}

export async function calibrateGarmentFromProcessedImages(
  frontBlob: Blob,
  backBlob: Blob,
): Promise<GarmentCalibration> {
  const [frontImage, backImage] = await Promise.all([
    decodeAlpha(frontBlob),
    decodeAlpha(backBlob),
  ]);

  return buildGarmentCalibration(
    analyzeAlphaSilhouette(frontImage),
    analyzeAlphaSilhouette(backImage),
  );
}
