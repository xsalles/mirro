import {
  buildBodyCalibration,
  segmentBodySilhouette,
  type RgbaImage,
} from "./body-calibration";
import { buildBodyVisualHull } from "./body-visual-hull";
import { refineVisualHullPhotometrically } from "./body-photometric-refinement";
import { buildClassicalMultiViewStereo } from "./body-mvs";
import {
  BODY_VIEW_LABEL,
  BODY_VIEW_SEQUENCE,
  CORE_BODY_SIDES,
  isCoreBodySide,
} from "./body-views";
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
import { scaleOpticalIntrinsics } from "./optical-calibration";
import type {
  BodyCalibration,
  BodyMeasurements,
  BodySide,
  BodySilhouette,
  BodyViewId,
  OpticalCalibrationProfile,
} from "./types";

function opticalAspectCompatible(
  image: RgbaImage,
  optics: OpticalCalibrationProfile,
) {
  const imageAspect = image.width / Math.max(1, image.height);
  const opticsAspect =
    optics.imageWidth / Math.max(1, optics.imageHeight);
  return (
    Math.abs(imageAspect / Math.max(1e-6, opticsAspect) - 1) <=
    0.025
  );
}

function applyDedicatedOptics(
  image: RgbaImage,
  optics: OpticalCalibrationProfile,
) {
  const intrinsics = scaleOpticalIntrinsics(
    optics.intrinsics,
    {
      width: optics.imageWidth,
      height: optics.imageHeight,
    },
    {
      width: image.width,
      height: image.height,
    },
  );
  return undistortRgbaImage(
    image,
    intrinsics,
    optics.distortion,
  );
}

export async function calibrateBodyFromPhotos(
  photos: Partial<Record<BodyViewId, Blob>>,
  measurements: BodyMeasurements,
  optics?: OpticalCalibrationProfile,
): Promise<BodyCalibration> {
  let opticsMismatch = false;

  for (const side of CORE_BODY_SIDES) {
    if (!photos[side]) {
      throw new Error(
        `${BODY_VIEW_LABEL[side]}: foto obrigatória ausente.`,
      );
    }
  }

  const activeViews = BODY_VIEW_SEQUENCE.filter(
    (view) => Boolean(photos[view]),
  );

  const rawEntries = await Promise.all(
    activeViews.map(
      async (side) => {
        const blob = photos[side]!;
        try {
          const decoded = await decodeForCalibration(blob);
          const canApplyOptics = Boolean(
            optics && opticalAspectCompatible(decoded, optics),
          );
          if (optics && !canApplyOptics) opticsMismatch = true;
          const image =
            optics && canApplyOptics
              ? applyDedicatedOptics(decoded, optics)
              : decoded;
          const viewCalibration =
            detectBodyViewCalibration(image);
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
            dedicatedOpticsApplied: Boolean(
              optics && canApplyOptics,
            ),
          };
        } catch (error) {
          const detail =
            error instanceof Error
              ? error.message
              : "Não foi possível segmentar a imagem.";
          throw new Error(
            `${BODY_VIEW_LABEL[side]}: ${detail}`,
          );
        }
      },
    ),
  );

  const dedicatedOpticsApplied = rawEntries.every(
    (entry) => entry.dedicatedOpticsApplied,
  );

  let workingEntries = rawEntries;
  let cameraRig: BodyCalibration["cameraRig"];
  let calibratedViews:
    | Record<
        BodySide,
        NonNullable<
          (typeof rawEntries)[number]["viewCalibration"]
        >
      >
    | undefined;
  let cameraSolveWarning: string | null = null;

  const rawViewEntries = rawEntries.filter(
    (
      entry,
    ): entry is typeof entry & {
      side: BodySide;
      viewCalibration: NonNullable<
        typeof entry.viewCalibration
      >;
    } =>
      isCoreBodySide(entry.side) &&
      Boolean(entry.viewCalibration),
  );

  if (rawViewEntries.length === 4) {
    const rawViews = Object.fromEntries(
      rawViewEntries.map((entry) => [
        entry.side,
        entry.viewCalibration,
      ]),
    ) as Record<
      BodySide,
      NonNullable<
        (typeof rawEntries)[number]["viewCalibration"]
      >
    >;

    try {
      const initialSolved = solveBodyCameraRig(rawViews);

      if (dedicatedOpticsApplied) {
        cameraRig = initialSolved.rig;
        calibratedViews = initialSolved.calibrations;
      } else {
        const lens = estimateLensDistortion(
          rawViews,
          initialSolved.rig,
        );
        const useLens =
          lens.improvementPx > 0.08 &&
          lens.distortedRmsPx + 0.02 <
            lens.baselineRmsPx;

        if (useLens) {
          const undistortedEntries = rawEntries.map(
            (entry) => {
              const image = undistortRgbaImage(
                entry.image,
                initialSolved.rig.intrinsics,
                lens.distortion,
              );
              const viewCalibration =
                detectBodyViewCalibration(image);
              const segmented =
                segmentBodySilhouette(image);
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
            },
          );

          const undistortedViewEntries =
            undistortedEntries.filter(
              (
                entry,
              ): entry is typeof entry & {
                side: BodySide;
                viewCalibration: NonNullable<
                  typeof entry.viewCalibration
                >;
              } =>
                isCoreBodySide(entry.side) &&
                Boolean(entry.viewCalibration),
            );

          if (undistortedViewEntries.length === 4) {
            const undistortedViews =
              Object.fromEntries(
                undistortedViewEntries.map((entry) => [
                  entry.side,
                  entry.viewCalibration,
                ]),
              ) as Record<
                BodySide,
                NonNullable<
                  (typeof rawEntries)[number]["viewCalibration"]
                >
              >;

            const solved =
              solveBodyCameraRig(undistortedViews);
            cameraRig = {
              ...solved.rig,
              version: 2,
              method: "brown-conrady-bundle-v2",
              distortion: lens.distortion,
              distortionRmsImprovementPx:
                lens.improvementPx,
              warnings: [
                ...solved.rig.warnings,
                ...(lens.improvementPx < 0.25
                  ? [
                      "A distorção de lente detectada é pequena; a correção foi aplicada de forma conservadora.",
                    ]
                  : []),
              ],
            };
            calibratedViews = solved.calibrations;
            workingEntries = undistortedEntries;
          } else {
            cameraRig = initialSolved.rig;
            calibratedViews =
              initialSolved.calibrations;
            cameraSolveWarning =
              "A lente foi estimada, mas o alvo não permaneceu estável após undistortion; o MIRRO manteve a calibração pinhole.";
          }
        } else {
          cameraRig = initialSolved.rig;
          calibratedViews =
            initialSolved.calibrations;
        }
      }
    } catch {
      cameraSolveWarning =
        "As vistas métricas ficaram degeneradas para pose; o MIRRO manteve a reconstrução por silhuetas.";
    }
  }

  const denseSilhouettes = Object.fromEntries(
    workingEntries.map((entry) => [
      entry.side,
      entry.silhouette,
    ]),
  ) as Partial<Record<BodyViewId, BodySilhouette>>;

  const silhouettes = Object.fromEntries(
    CORE_BODY_SIDES.map((side) => [
      side,
      denseSilhouettes[side]!,
    ]),
  ) as Record<BodySide, BodySilhouette>;

  if (calibratedViews) {
    for (const side of Object.keys(
      silhouettes,
    ) as BodySide[]) {
      silhouettes[side] =
        rectifySilhouetteWithPinhole(
          silhouettes[side],
          calibratedViews[side],
        );
      denseSilhouettes[side] = silhouettes[side];
    }
  }

  const entryBySide = Object.fromEntries(
    workingEntries.map((entry) => [entry.side, entry]),
  ) as Partial<Record<BodyViewId, (typeof workingEntries)[number]>>;

  const images = Object.fromEntries(
    CORE_BODY_SIDES.map((side) => [
      side,
      entryBySide[side]!.image,
    ]),
  ) as Record<BodySide, RgbaImage>;
  const masks = Object.fromEntries(
    CORE_BODY_SIDES.map((side) => [
      side,
      entryBySide[side]!.mask,
    ]),
  ) as Record<BodySide, Uint8Array>;

  const denseImages = Object.fromEntries(
    workingEntries.map((entry) => [
      entry.side,
      entry.image,
    ]),
  ) as Partial<Record<BodyViewId, RgbaImage>>;
  const denseMasks = Object.fromEntries(
    workingEntries.map((entry) => [
      entry.side,
      entry.mask,
    ]),
  ) as Partial<Record<BodyViewId, Uint8Array>>;

  const textureCalibration =
    analyzeBodyTextureCalibration({
      images,
      masks,
      silhouettes,
    });

  const base = buildBodyCalibration(
    silhouettes,
    measurements,
  );

  let visualHull: NonNullable<
    BodyCalibration["mesh"]["visualHull"]
  > | null = null;
  let visualHullWarning: string | null = null;
  let multiViewStereoWarning: string | null = null;

  if (base.quality.score >= 0.5) {
    try {
      visualHull = buildBodyVisualHull({
        views: Object.fromEntries(
          workingEntries.map((entry) => [
            entry.side,
            {
              mask: entry.mask,
              width: entry.image.width,
              height: entry.image.height,
            },
          ]),
        ) as Partial<
          Record<
            BodyViewId,
            {
              mask: Uint8Array;
              width: number;
              height: number;
            }
          >
        >,
        silhouettes: denseSilhouettes,
        baseMesh: base.mesh,
        bodyHeightCm: measurements.heightCm,
      });

      if (visualHull.viewCount === 8) {
        visualHull = refineVisualHullPhotometrically({
          hull: visualHull,
          baseMesh: base.mesh,
          images: denseImages,
          masks: denseMasks,
          silhouettes: denseSilhouettes,
          bodyHeightCm: measurements.heightCm,
        });

        const hasAllDenseInputs = BODY_VIEW_SEQUENCE.every(
          (view) =>
            Boolean(
              denseImages[view] &&
                denseMasks[view] &&
                denseSilhouettes[view],
            ),
        );

        if (hasAllDenseInputs) {
          const multiViewStereo =
            buildClassicalMultiViewStereo({
              hull: visualHull,
              images: denseImages as Record<
                BodyViewId,
                RgbaImage
              >,
              masks: denseMasks as Record<
                BodyViewId,
                Uint8Array
              >,
              silhouettes: denseSilhouettes as Record<
                BodyViewId,
                BodySilhouette
              >,
              bodyHeightCm: measurements.heightCm,
            });

          if (multiViewStereo) {
            visualHull = {
              ...visualHull,
              multiViewStereo,
            };
          } else {
            multiViewStereoWarning =
              "As oito vistas não tiveram textura/correspondência suficiente para gerar um TSDF MVS confiável; o MIRRO manteve o visual hull + SDF.";
          }
        }
      }
    } catch (error) {
      visualHullWarning =
        error instanceof Error
          ? error.message
          : "O visual hull denso não pôde ser gerado.";
    }
  }

  const mesh = visualHull
    ? {
        ...base.mesh,
        visualHull,
      }
    : base.mesh;

  const warnings = [
    ...base.quality.warnings,
    ...(cameraRig?.warnings ?? []),
    ...(cameraSolveWarning
      ? [cameraSolveWarning]
      : []),
    ...(visualHullWarning
      ? [visualHullWarning]
      : []),
    ...(multiViewStereoWarning
      ? [multiViewStereoWarning]
      : []),
    ...(opticsMismatch
      ? [
          "O perfil óptico salvo usa outra proporção de imagem; a correção dedicada não foi aplicada nesta captura.",
        ]
      : []),
  ];

  const hasVisualHull = Boolean(visualHull);
  const hasEightViewSdf = Boolean(
    visualHull?.viewCount === 8 &&
      visualHull.signedDistanceField,
  );
  const hasMultiViewStereo = Boolean(
    visualHull?.multiViewStereo,
  );
  const hasBodyLens = cameraRig?.version === 2;
  const version: BodyCalibration["version"] =
    hasMultiViewStereo
      ? 8
      : hasEightViewSdf
        ? 7
        : hasVisualHull
          ? 6
          : hasBodyLens
            ? 5
            : cameraRig
              ? 4
              : base.version;
  const method: BodyCalibration["method"] =
    hasMultiViewStereo
      ? "turntable-zncc-tsdf-mvs-v8"
      : hasEightViewSdf
        ? "eight-view-sdf-gradient-seams-v7"
        : hasVisualHull
          ? "visual-hull-multiband-v6"
          : hasBodyLens
            ? "lens-undistorted-local-color-surface-v5"
            : cameraRig
              ? "pinhole-bundle-anatomical-v4"
              : base.method;

  const opticalScore = optics
    ? optics.conditionScore * 0.04
    : 0;
  const cameraScore = cameraRig
    ? Math.max(
        0,
        1 -
          cameraRig.rmsReprojectionErrorPx / 5,
      ) * 0.14
    : 0;
  const denseBonus = hasVisualHull ? 0.06 : 0;
  const mvsBonus = hasMultiViewStereo
    ? Math.min(
        0.07,
        0.035 +
          (visualHull?.multiViewStereo?.meanConfidence ?? 0) *
            0.035,
      )
    : 0;
  const baseWeight =
    1 -
    0.1 -
    (cameraRig ? 0.14 : 0) -
    (optics ? 0.04 : 0) -
    (hasVisualHull ? 0.06 : 0) -
    (hasMultiViewStereo ? 0.07 : 0);

  return {
    ...base,
    version,
    method,
    mesh,
    denseSilhouettes,
    viewCalibration:
      calibratedViews ?? base.viewCalibration,
    cameraRig,
    textureCalibration,
    quality: {
      ...base.quality,
      score: Math.min(
        1,
        base.quality.score * baseWeight +
          textureCalibration.score * 0.1 +
          cameraScore +
          opticalScore +
          denseBonus +
          mvsBonus,
      ),
      warnings: [...new Set(warnings)],
    },
  };
}
