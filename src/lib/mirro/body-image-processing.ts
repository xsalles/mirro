import { buildBodyCalibration, segmentBodySilhouette, type RgbaImage } from "./body-calibration";
import { decodeForCalibration } from "./image-processing";
import {
  applyMetricViewCalibration,
  detectBodyViewCalibration,
} from "./body-camera-calibration";
import {
  rectifySilhouetteWithPinhole,
  solveBodyCameraRig,
} from "./camera-rig";
import { analyzeBodyTextureCalibration } from "./body-texture-calibration";
import {
  estimateLensDistortion,
  undistortRgbaImage,
} from "./lens-distortion";
import type { BodyCalibration, BodyMeasurements, BodySide, BodySilhouette } from "./types";

export async function calibrateBodyFromPhotos(
  photos: Record<BodySide, Blob>,
  measurements: BodyMeasurements,
): Promise<BodyCalibration> {
  const rawEntries = await Promise.all(
    (Object.entries(photos) as Array<[BodySide, Blob]>).map(async ([side, blob]) => {
      try {
        const image = await decodeForCalibration(blob);
        const viewCalibration = detectBodyViewCalibration(image);
        const segmented = segmentBodySilhouette(image);
        return {
          side,
          image,
          mask: segmented.mask,
          silhouette: applyMetricViewCalibration(
            segmented.silhouette,
            viewCalibration,
          ),
          viewCalibration,
        };
      } catch (error) {
        const detail =
          error instanceof Error
            ? error.message
            : "Não foi possível segmentar a imagem.";
        throw new Error(`${SIDE_LABELS[side]}: ${detail}`);
      }
    }),
  );

  let workingEntries = rawEntries;
  let cameraRig: BodyCalibration["cameraRig"];
  let calibratedViews: Record<BodySide, NonNullable<(typeof rawEntries)[number]["viewCalibration"]>> | undefined;
  let cameraSolveWarning: string | null = null;

  const rawViewEntries = rawEntries.filter(
    (entry): entry is typeof entry & {
      viewCalibration: NonNullable<typeof entry.viewCalibration>;
    } => Boolean(entry.viewCalibration),
  );

  if (rawViewEntries.length === 4) {
    const rawViews = Object.fromEntries(
      rawViewEntries.map((entry) => [entry.side, entry.viewCalibration]),
    ) as Record<BodySide, NonNullable<(typeof rawEntries)[number]["viewCalibration"]>>;

    try {
      const initialSolved = solveBodyCameraRig(rawViews);
      const lens = estimateLensDistortion(rawViews, initialSolved.rig);
      const useLens =
        lens.improvementPx > 0.08 &&
        lens.distortedRmsPx + 0.02 < lens.baselineRmsPx;

      if (useLens) {
        const undistortedEntries = rawEntries.map((entry) => {
          const image = undistortRgbaImage(
            entry.image,
            initialSolved.rig.intrinsics,
            lens.distortion,
          );
          const viewCalibration = detectBodyViewCalibration(image);
          const segmented = segmentBodySilhouette(image);
          return {
            ...entry,
            image,
            mask: segmented.mask,
            silhouette: applyMetricViewCalibration(
              segmented.silhouette,
              viewCalibration,
            ),
            viewCalibration,
          };
        });

        const undistortedViewEntries = undistortedEntries.filter(
          (entry): entry is typeof entry & {
            viewCalibration: NonNullable<typeof entry.viewCalibration>;
          } => Boolean(entry.viewCalibration),
        );

        if (undistortedViewEntries.length === 4) {
          const undistortedViews = Object.fromEntries(
            undistortedViewEntries.map((entry) => [
              entry.side,
              entry.viewCalibration,
            ]),
          ) as Record<BodySide, NonNullable<(typeof rawEntries)[number]["viewCalibration"]>>;

          const solved = solveBodyCameraRig(undistortedViews);
          cameraRig = {
            ...solved.rig,
            version: 2,
            method: "brown-conrady-bundle-v2",
            distortion: lens.distortion,
            distortionRmsImprovementPx: lens.improvementPx,
            warnings: [
              ...solved.rig.warnings,
              ...(lens.improvementPx < 0.25
                ? ["A distorção de lente detectada é pequena; a correção foi aplicada de forma conservadora."]
                : []),
            ],
          };
          calibratedViews = solved.calibrations;
          workingEntries = undistortedEntries;
        } else {
          cameraRig = initialSolved.rig;
          calibratedViews = initialSolved.calibrations;
          cameraSolveWarning =
            "A lente foi estimada, mas o alvo não permaneceu estável após undistortion; o MIRRO manteve a calibração pinhole v4.";
        }
      } else {
        cameraRig = initialSolved.rig;
        calibratedViews = initialSolved.calibrations;
      }
    } catch {
      cameraSolveWarning =
        "As quatro vistas têm escala métrica, mas a solução óptica ficou degenerada. O MIRRO manteve o BodyMesh métrico; varie mais a perspectiva do cartão.";
    }
  }

  const silhouettes = Object.fromEntries(
    workingEntries.map((entry) => [entry.side, entry.silhouette]),
  ) as Record<BodySide, BodySilhouette>;

  if (calibratedViews) {
    for (const side of Object.keys(silhouettes) as BodySide[]) {
      silhouettes[side] = rectifySilhouetteWithPinhole(
        silhouettes[side],
        calibratedViews[side],
      );
    }
  }

  const images = Object.fromEntries(
    workingEntries.map((entry) => [entry.side, entry.image]),
  ) as Record<BodySide, RgbaImage>;
  const masks = Object.fromEntries(
    workingEntries.map((entry) => [entry.side, entry.mask]),
  ) as Record<BodySide, Uint8Array>;

  const textureCalibration = analyzeBodyTextureCalibration({
    images,
    masks,
    silhouettes,
  });

  const base = buildBodyCalibration(silhouettes, measurements);

  if (!cameraRig || !calibratedViews) {
    return {
      ...base,
      textureCalibration,
      quality: cameraSolveWarning
        ? {
            ...base.quality,
            warnings: [...base.quality.warnings, cameraSolveWarning],
          }
        : base.quality,
    };
  }

  const warnings = [
    ...base.quality.warnings,
    ...cameraRig.warnings,
    ...(cameraSolveWarning ? [cameraSolveWarning] : []),
  ];
  const isLensV5 = cameraRig.version === 2;

  return {
    ...base,
    version: isLensV5 ? 5 : 4,
    method: isLensV5
      ? "lens-undistorted-local-color-surface-v5"
      : "pinhole-bundle-anatomical-v4",
    viewCalibration: calibratedViews,
    cameraRig,
    textureCalibration,
    quality: {
      ...base.quality,
      score: Math.min(
        1,
        base.quality.score * 0.68 +
          Math.max(0, 1 - cameraRig.rmsReprojectionErrorPx / 5) * 0.17 +
          textureCalibration.score * 0.1 +
          (isLensV5 ? 0.05 : 0),
      ),
      warnings: [...new Set(warnings)],
    },
  };
}
