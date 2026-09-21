"use client";

import { useEffect, useRef } from "react";
import type { BodyMesh, GarmentMesh } from "@/lib/mirro/types";

type Point2D = { x: number; y: number; depth: number };

export function ClothSimulationPreview({
  bodyMesh,
  garmentMesh,
  revision,
  yawDegrees,
}: {
  bodyMesh: BodyMesh;
  garmentMesh: GarmentMesh;
  revision: number;
  yawDegrees: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    void revision;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;
    const root = getComputedStyle(document.documentElement);
    const thread = root.getPropertyValue("--thread").trim() || "#5266ff";
    const line = root.getPropertyValue("--line").trim() || "#dfe2e8";
    const muted = root.getPropertyValue("--muted").trim() || "#626875";
    const yaw = (yawDegrees * Math.PI) / 180;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const sceneWidth = bodyMesh.boundsCm.width + bodyMesh.boundsCm.depth * 0.7;
    const scale = Math.min(
      (width - 52) / Math.max(sceneWidth, 1),
      (height - 46) / Math.max(bodyMesh.boundsCm.height, 1),
    );

    function project(x: number, y: number, z: number): Point2D {
      const rx = x * cos + z * sin;
      const rz = -x * sin + z * cos;
      return {
        x: width / 2 + rx * scale,
        y: height / 2 - y * scale,
        depth: rz,
      };
    }

    function bodyPoint(index: number) {
      const offset = index * 3;
      return project(
        bodyMesh.vertices[offset],
        bodyMesh.vertices[offset + 1],
        bodyMesh.vertices[offset + 2],
      );
    }

    function garmentPoint(index: number) {
      const offset = index * 3;
      return project(
        garmentMesh.positions[offset],
        garmentMesh.positions[offset + 1],
        garmentMesh.positions[offset + 2],
      );
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = line;
    context.lineWidth = 1;
    context.globalAlpha = 0.8;

    for (let ring = 0; ring < bodyMesh.ringCount; ring += 4) {
      context.beginPath();
      for (let segment = 0; segment <= bodyMesh.segmentsPerRing; segment += 1) {
        const normalized = segment % bodyMesh.segmentsPerRing;
        const point = bodyPoint(ring * bodyMesh.segmentsPerRing + normalized);
        if (segment === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.stroke();
    }

    context.globalAlpha = 0.42;
    for (let segment = 0; segment < bodyMesh.segmentsPerRing; segment += 4) {
      context.beginPath();
      for (let ring = 0; ring < bodyMesh.ringCount; ring += 1) {
        const point = bodyPoint(ring * bodyMesh.segmentsPerRing + segment);
        if (ring === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.stroke();
    }

    const triangles: Array<{
      a: Point2D;
      b: Point2D;
      c: Point2D;
      depth: number;
    }> = [];

    for (let offset = 0; offset < garmentMesh.indices.length; offset += 3) {
      const a = garmentPoint(garmentMesh.indices[offset]);
      const b = garmentPoint(garmentMesh.indices[offset + 1]);
      const c = garmentPoint(garmentMesh.indices[offset + 2]);
      triangles.push({ a, b, c, depth: (a.depth + b.depth + c.depth) / 3 });
    }

    triangles.sort((a, b) => a.depth - b.depth);
    context.fillStyle = thread;
    context.strokeStyle = thread;
    context.lineWidth = 0.65;

    for (const triangle of triangles) {
      context.beginPath();
      context.moveTo(triangle.a.x, triangle.a.y);
      context.lineTo(triangle.b.x, triangle.b.y);
      context.lineTo(triangle.c.x, triangle.c.y);
      context.closePath();
      context.globalAlpha = 0.085;
      context.fill();
      context.globalAlpha = 0.22;
      context.stroke();
    }

    context.globalAlpha = 1;
    context.fillStyle = muted;
    context.font = "600 11px Manrope, sans-serif";
    context.textAlign = "right";
    context.fillText(`${garmentMesh.positions.length / 3} partículas`, width - 14, 20);
  }, [bodyMesh, garmentMesh, revision, yawDegrees]);

  return (
    <figure>
      <canvas
        ref={canvasRef}
        width={620}
        height={760}
        role="img"
        aria-label="Simulação tridimensional da peça deformada sobre o BodyMesh"
        className="aspect-[31/38] w-full bg-white"
      />
      <figcaption className="border-t border-[var(--line)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
        Preview geométrico do XPBD. A malha usa o contorno real da peça; textura fotográfica deformada ainda não é renderizada nesta etapa.
      </figcaption>
    </figure>
  );
}
