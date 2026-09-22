"use client";

import { useEffect, useRef } from "react";
import type { BodyCalibration } from "@/lib/mirro/types";

export function BodyMeshPreview({ calibration }: { calibration: BodyCalibration }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const mesh = calibration.mesh;
    const surface = mesh.visualHull;
    const surfaceVertices =
      surface?.multiViewStereo?.surfaceVertices ??
      surface?.photometricRefinement?.surfaceVertices ??
      surface?.vertices ??
      mesh.vertices;
    const surfaceIndices =
      surface?.multiViewStereo?.surfaceIndices ??
      surface?.indices ??
      mesh.indices;
    const width = canvas.width;
    const height = canvas.height;
    const rootStyle = getComputedStyle(document.documentElement);
    const thread = rootStyle.getPropertyValue("--thread").trim() || "#5266ff";
    const line = rootStyle.getPropertyValue("--line").trim() || "#dfe2e8";
    const muted = rootStyle.getPropertyValue("--muted").trim() || "#626875";

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = line;
    context.lineWidth = 1;
    context.setLineDash([4, 6]);
    context.beginPath();
    context.moveTo(width / 2, 18);
    context.lineTo(width / 2, height - 18);
    context.stroke();
    context.setLineDash([]);

    const yaw = Math.PI / 7;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const projectedWidth = mesh.boundsCm.width + mesh.boundsCm.depth * 0.55;
    const scale = Math.min(
      (width - 56) / Math.max(projectedWidth, 1),
      (height - 44) / Math.max(mesh.boundsCm.height, 1),
    );

    function project(vertexIndex: number) {
      const offset = vertexIndex * 3;
      const x = surfaceVertices[offset] ?? 0;
      const y = surfaceVertices[offset + 1] ?? 0;
      const z = surfaceVertices[offset + 2] ?? 0;
      const rotatedX = x * cos + z * sin;
      return {
        x: width / 2 + rotatedX * scale,
        y: height / 2 - y * scale,
      };
    }

    context.strokeStyle = thread;
    context.globalAlpha = 0.34;
    context.lineWidth = 0.55;

    const stride = surface ? 5 : mesh.version >= 2 ? 2 : 1;
    for (
      let offset = 0;
      offset < surfaceIndices.length;
      offset += 3 * stride
    ) {
      const a = project(surfaceIndices[offset]);
      const b = project(surfaceIndices[offset + 1]);
      const c = project(surfaceIndices[offset + 2]);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.lineTo(c.x, c.y);
      context.closePath();
      context.stroke();
    }

    if (mesh.parts?.length) {
      context.globalAlpha = 1;
      context.fillStyle = muted;
      context.font = "600 10px Manrope, sans-serif";
      context.textAlign = "center";

      for (const part of mesh.parts) {
        const center = part.centerCm;
        const rotatedX = center[0] * cos + center[2] * sin;
        const x = width / 2 + rotatedX * scale;
        const y = height / 2 - center[1] * scale;
        context.fillText(part.kind.replace("-", " "), x, y);
      }
    }

    context.globalAlpha = 1;
    context.fillStyle = muted;
    context.font = "600 11px Manrope, sans-serif";
    context.textAlign = "right";
    context.fillText(
      surface?.multiViewStereo
        ? `${mesh.boundsCm.height.toFixed(0)} cm · MVS ${(surface.multiViewStereo.surfaceIndices.length / 3).toLocaleString("pt-BR")} tri`
        : surface
          ? `${mesh.boundsCm.height.toFixed(0)} cm · visual hull ${(surface.indices.length / 3).toLocaleString("pt-BR")} tri`
          : `${mesh.boundsCm.height.toFixed(0)} cm · v${mesh.version}`,
      width - 16,
      20,
    );
  }, [calibration]);

  return (
    <figure>
      <canvas
        ref={canvasRef}
        width={420}
        height={540}
        className="aspect-[7/9] w-full rounded-2xl border border-[var(--line)] bg-white"
        aria-hidden="true"
      />
      <figcaption className="mt-2 text-xs leading-5 text-[var(--muted)]">
        {calibration.version === 8 &&
        calibration.mesh.visualHull?.multiViewStereo
          ? "Scanner v8: 8 depth maps por ZNCC, consistência cruzada e TSDF fusionado para a superfície visual; o SDF conservador continua protegendo a colisão."
          : calibration.version === 7 &&
              calibration.mesh.visualHull?.signedDistanceField
            ? "Scanner v7: 8 silhuetas a cada 45°, visual hull apertado nas diagonais e SDF 3D persistido para colisão por gradiente."
          : calibration.mesh.visualHull
            ? "Visual hull v6: volume esculpido pelas quatro máscaras completas e superfície extraída por marching tetrahedra com suavização Taubin."
          : calibration.mesh.version === 4
            ? "BodyMesh v4: torso 96×48 com linha central frente–costas derivada das laterais; UV e colisão acompanham a assimetria observada."
          : calibration.mesh.version === 3
            ? "BodyMesh v3 métrico: anatomia por partes com escala por alvo A4 e medidas avançadas quando informadas."
            : calibration.mesh.version === 2
              ? "BodyMesh v2 por partes: torso, cabeça, braços e pernas possuem geometria e colisão próprias."
              : "Perfil legado v1. Ao recalibrar, o MIRRO gera automaticamente a topologia anatômica atual."}
      </figcaption>
    </figure>
  );
}
