"use client";

import { useEffect, useRef, useState } from "react";
import type { BodyMesh, GarmentMesh } from "@/lib/mirro/types";

type Point2D = { x: number; y: number; depth: number };

function loadCanvasImage(url: string | null) {
  if (!url) return Promise.resolve<HTMLImageElement | null>(null);

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível carregar a textura da peça."));
    image.src = url;
  });
}

function drawTexturedTriangle(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: Array<{ x: number; y: number }>,
  destination: Point2D[],
) {
  const [s1, s2, s3] = source;
  const [d1, d2, d3] = destination;
  const denominator =
    s1.x * (s2.y - s3.y) +
    s2.x * (s3.y - s1.y) +
    s3.x * (s1.y - s2.y);

  if (Math.abs(denominator) < 1e-5) return;

  const a =
    (d1.x * (s2.y - s3.y) +
      d2.x * (s3.y - s1.y) +
      d3.x * (s1.y - s2.y)) /
    denominator;
  const c =
    (d1.x * (s3.x - s2.x) +
      d2.x * (s1.x - s3.x) +
      d3.x * (s2.x - s1.x)) /
    denominator;
  const e =
    (d1.x * (s2.x * s3.y - s3.x * s2.y) +
      d2.x * (s3.x * s1.y - s1.x * s3.y) +
      d3.x * (s1.x * s2.y - s2.x * s1.y)) /
    denominator;

  const b =
    (d1.y * (s2.y - s3.y) +
      d2.y * (s3.y - s1.y) +
      d3.y * (s1.y - s2.y)) /
    denominator;
  const d =
    (d1.y * (s3.x - s2.x) +
      d2.y * (s1.x - s3.x) +
      d3.y * (s2.x - s1.x)) /
    denominator;
  const f =
    (d1.y * (s2.x * s3.y - s3.x * s2.y) +
      d2.y * (s3.x * s1.y - s1.x * s3.y) +
      d3.y * (s1.x * s2.y - s2.x * s1.y)) /
    denominator;

  context.save();
  context.beginPath();
  context.moveTo(d1.x, d1.y);
  context.lineTo(d2.x, d2.y);
  context.lineTo(d3.x, d3.y);
  context.closePath();
  context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(image, 0, 0);
  context.restore();
}

export function ClothSimulationPreview({
  bodyMesh,
  garmentMesh,
  revision,
  yawDegrees,
  frontTextureUrl,
  backTextureUrl,
  textured,
}: {
  bodyMesh: BodyMesh;
  garmentMesh: GarmentMesh;
  revision: number;
  yawDegrees: number;
  frontTextureUrl: string | null;
  backTextureUrl: string | null;
  textured: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frontTextureRef = useRef<HTMLImageElement | null>(null);
  const backTextureRef = useRef<HTMLImageElement | null>(null);
  const [textureRevision, setTextureRevision] = useState(0);

  useEffect(() => {
    let active = true;

    Promise.all([
      loadCanvasImage(frontTextureUrl),
      loadCanvasImage(backTextureUrl),
    ])
      .then(([front, back]) => {
        if (!active) return;
        frontTextureRef.current = front;
        backTextureRef.current = back;
        setTextureRevision((value) => value + 1);
      })
      .catch(() => {
        if (!active) return;
        frontTextureRef.current = null;
        backTextureRef.current = null;
        setTextureRevision((value) => value + 1);
      });

    return () => {
      active = false;
    };
  }, [frontTextureUrl, backTextureUrl]);

  useEffect(() => {
    void revision;
    void textureRevision;
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

    const canTexture =
      textured &&
      frontTextureRef.current !== null &&
      backTextureRef.current !== null;

    const garmentTriangles: Array<{
      indices: [number, number, number];
      points: [Point2D, Point2D, Point2D];
      depth: number;
      panel: 0 | 1;
    }> = [];

    for (let offset = 0; offset < garmentMesh.indices.length; offset += 3) {
      const ia = garmentMesh.indices[offset];
      const ib = garmentMesh.indices[offset + 1];
      const ic = garmentMesh.indices[offset + 2];
      const a = garmentPoint(ia);
      const b = garmentPoint(ib);
      const c = garmentPoint(ic);
      garmentTriangles.push({
        indices: [ia, ib, ic],
        points: [a, b, c],
        depth: (a.depth + b.depth + c.depth) / 3,
        panel: garmentMesh.textureSide
          ? garmentMesh.textureSide[ia] === 1 ? 1 : 0
          : ia < garmentMesh.panelVertexCount ? 0 : 1,
      });
    }

    if (canTexture) {
      const sceneTriangles: Array<
        | {
            kind: "body";
            points: [Point2D, Point2D, Point2D];
            depth: number;
          }
        | {
            kind: "garment";
            indices: [number, number, number];
            points: [Point2D, Point2D, Point2D];
            depth: number;
            panel: 0 | 1;
          }
      > = [];

      for (let offset = 0; offset < bodyMesh.indices.length; offset += 3) {
        const a = bodyPoint(bodyMesh.indices[offset]);
        const b = bodyPoint(bodyMesh.indices[offset + 1]);
        const c = bodyPoint(bodyMesh.indices[offset + 2]);
        sceneTriangles.push({
          kind: "body",
          points: [a, b, c],
          depth: (a.depth + b.depth + c.depth) / 3,
        });
      }

      for (const triangle of garmentTriangles) {
        sceneTriangles.push({ kind: "garment", ...triangle });
      }

      sceneTriangles.sort((a, b) => a.depth - b.depth);

      for (const triangle of sceneTriangles) {
        if (triangle.kind === "body") {
          context.beginPath();
          context.moveTo(triangle.points[0].x, triangle.points[0].y);
          context.lineTo(triangle.points[1].x, triangle.points[1].y);
          context.lineTo(triangle.points[2].x, triangle.points[2].y);
          context.closePath();
          context.fillStyle = "#f8f9fb";
          context.globalAlpha = 1;
          context.fill();
          context.strokeStyle = line;
          context.lineWidth = 0.45;
          context.globalAlpha = 0.28;
          context.stroke();
          continue;
        }

        const texture =
          triangle.panel === 0
            ? frontTextureRef.current
            : backTextureRef.current;
        if (!texture) continue;

        const source = triangle.indices.map((index) => ({
          x: garmentMesh.uv[index * 2] * texture.width,
          y: garmentMesh.uv[index * 2 + 1] * texture.height,
        }));

        context.globalAlpha = 1;
        drawTexturedTriangle(context, texture, source, triangle.points);
        context.beginPath();
        context.moveTo(triangle.points[0].x, triangle.points[0].y);
        context.lineTo(triangle.points[1].x, triangle.points[1].y);
        context.lineTo(triangle.points[2].x, triangle.points[2].y);
        context.closePath();
        context.strokeStyle = thread;
        context.lineWidth = 0.45;
        context.globalAlpha = 0.055;
        context.stroke();
      }
    } else {
      context.strokeStyle = line;
      context.lineWidth = 0.55;
      context.globalAlpha = 0.42;

      for (let offset = 0; offset < bodyMesh.indices.length; offset += 3) {
        const a = bodyPoint(bodyMesh.indices[offset]);
        const b = bodyPoint(bodyMesh.indices[offset + 1]);
        const c = bodyPoint(bodyMesh.indices[offset + 2]);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.lineTo(c.x, c.y);
        context.closePath();
        context.stroke();
      }

      garmentTriangles.sort((a, b) => a.depth - b.depth);
      for (const triangle of garmentTriangles) {
        context.beginPath();
        context.moveTo(triangle.points[0].x, triangle.points[0].y);
        context.lineTo(triangle.points[1].x, triangle.points[1].y);
        context.lineTo(triangle.points[2].x, triangle.points[2].y);
        context.closePath();
        context.fillStyle = thread;
        context.globalAlpha = 0.085;
        context.fill();
        context.strokeStyle = thread;
        context.lineWidth = 0.55;
        context.globalAlpha = 0.22;
        context.stroke();
      }
    }

    context.globalAlpha = 1;
    context.fillStyle = muted;
    context.font = "600 11px Manrope, sans-serif";
    context.textAlign = "right";
    context.fillText(
      canTexture
        ? "textura real · depth-sorted"
        : `${garmentMesh.positions.length / 3} partículas`,
      width - 14,
      20,
    );
  }, [
    bodyMesh,
    garmentMesh,
    revision,
    yawDegrees,
    textureRevision,
    textured,
  ]);

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
        Durante o cálculo, o MIRRO mostra a malha física. No resultado final, corpo e roupa são ordenados por profundidade e as fotos reais são projetadas sobre os UVs resolvidos.
      </figcaption>
    </figure>
  );
}
