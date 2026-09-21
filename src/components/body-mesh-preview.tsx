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
      const x = mesh.vertices[offset];
      const y = mesh.vertices[offset + 1];
      const z = mesh.vertices[offset + 2];
      const rotatedX = x * cos + z * sin;
      return {
        x: width / 2 + rotatedX * scale,
        y: height / 2 - y * scale,
      };
    }

    context.strokeStyle = thread;
    context.globalAlpha = 0.72;
    context.lineWidth = 1;

    for (let ring = 0; ring < mesh.ringCount; ring += 3) {
      context.beginPath();
      for (let segment = 0; segment <= mesh.segmentsPerRing; segment += 1) {
        const normalized = segment % mesh.segmentsPerRing;
        const point = project(ring * mesh.segmentsPerRing + normalized);
        if (segment === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.stroke();
    }

    context.globalAlpha = 0.44;
    for (let segment = 0; segment < mesh.segmentsPerRing; segment += 4) {
      context.beginPath();
      for (let ring = 0; ring < mesh.ringCount; ring += 1) {
        const point = project(ring * mesh.segmentsPerRing + segment);
        if (ring === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.stroke();
    }

    context.globalAlpha = 1;
    context.fillStyle = muted;
    context.font = "600 11px Manrope, sans-serif";
    context.textAlign = "right";
    context.fillText(`${mesh.boundsCm.height.toFixed(0)} cm`, width - 16, 20);
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
        Wireframe do hull corporal v1. É uma malha de colisão aproximada, não um modelo anatômico final.
      </figcaption>
    </figure>
  );
}
