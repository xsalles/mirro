"use client";

import { useEffect, useRef, useState } from "react";
import {
  bodyAtlasUvs,
  buildBodyTextureAtlas,
} from "@/lib/mirro/body-texture-atlas";
import type {
  BodyCalibration,
  BodyMesh,
  BodySide,
  FabricPhysicalProfile,
  FabricWeight,
  GarmentMesh,
  OpticalCalibrationProfile,
} from "@/lib/mirro/types";

type ThreeModule = typeof import("three/webgpu");

type SceneRuntime = {
  three: ThreeModule;
  renderer: InstanceType<ThreeModule["WebGPURenderer"]>;
  scene: InstanceType<ThreeModule["Scene"]>;
  camera: InstanceType<ThreeModule["PerspectiveCamera"]>;
  group: InstanceType<ThreeModule["Group"]>;
  frontGeometry: InstanceType<ThreeModule["BufferGeometry"]>;
  backGeometry: InstanceType<ThreeModule["BufferGeometry"]>;
  frontMaterial: InstanceType<ThreeModule["MeshPhysicalMaterial"]>;
  backMaterial: InstanceType<ThreeModule["MeshPhysicalMaterial"]>;
  bodyGeometry: InstanceType<ThreeModule["BufferGeometry"]>;
  bodyMaterial: InstanceType<ThreeModule["MeshPhysicalMaterial"]>;
  textures: Array<InstanceType<ThreeModule["Texture"]>>;
  resizeObserver: ResizeObserver;
};

function triangleSide(mesh: GarmentMesh, index: number) {
  if (mesh.textureSide) return mesh.textureSide[index] === 1 ? 1 : 0;
  return index < mesh.panelVertexCount ? 0 : 1;
}

function indicesForSide(mesh: GarmentMesh, side: 0 | 1) {
  const indices: number[] = [];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset];
    if (triangleSide(mesh, a) !== side) continue;
    indices.push(
      mesh.indices[offset],
      mesh.indices[offset + 1],
      mesh.indices[offset + 2],
    );
  }
  return indices;
}



function clothLook(
  weight: FabricWeight,
  profile?: FabricPhysicalProfile,
) {
  const fallback =
    weight === "light"
      ? { roughness: 0.58, sheen: 0.5, sheenRoughness: 0.45 }
      : weight === "heavy"
        ? { roughness: 0.86, sheen: 0.18, sheenRoughness: 0.82 }
        : { roughness: 0.72, sheen: 0.32, sheenRoughness: 0.64 };

  if (!profile) return fallback;

  const density = Math.min(1, Math.max(0, (profile.densityGsm - 80) / 360));
  const stiffness = Math.min(1, Math.max(0, profile.bendStiffness / 100));
  return {
    roughness: Math.min(0.94, Math.max(0.48, 0.58 + density * 0.24)),
    sheen: Math.min(0.65, Math.max(0.12, 0.52 - density * 0.26)),
    sheenRoughness: Math.min(0.9, Math.max(0.38, 0.48 + stiffness * 0.34)),
  };
}

export function ThreePbrPreview({
  bodyMesh,
  garmentMesh,
  revision,
  yawDegrees,
  frontTextureUrl,
  backTextureUrl,
  bodyCalibration,
  bodyTextureUrls,
  fabricWeight,
  fabricProfile,
  optics,
}: {
  bodyMesh: BodyMesh;
  garmentMesh: GarmentMesh;
  revision: number;
  yawDegrees: number;
  frontTextureUrl: string | null;
  backTextureUrl: string | null;
  bodyCalibration?: BodyCalibration;
  bodyTextureUrls?: Partial<Record<BodySide, string | null>>;
  fabricWeight: FabricWeight;
  fabricProfile?: FabricPhysicalProfile;
  optics?: OpticalCalibrationProfile | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [backendLabel, setBackendLabel] = useState("WebGPU / WebGL2");

  useEffect(() => {
    const currentHost = hostRef.current;
    if (!currentHost) return;
    const host: HTMLDivElement = currentHost;

    let disposed = false;

    async function setup() {
      setStatus("loading");
      const THREE = await import("three/webgpu");
      if (disposed) return;

      const renderer = new THREE.WebGPURenderer({
        antialias: true,
        alpha: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0xf4f5f7, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.03;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;

      host.replaceChildren(renderer.domElement);
      renderer.domElement.className = "size-full touch-none";
      renderer.domElement.setAttribute(
        "aria-label",
        "Renderização PBR tridimensional do corpo e da roupa",
      );
      renderer.domElement.setAttribute("role", "img");

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 1, 1200);
      const height = bodyMesh.boundsCm.height;
      camera.position.set(0, height * 0.025, height * 2.2);
      camera.lookAt(0, -height * 0.02, 0);

      const group = new THREE.Group();
      scene.add(group);

      const textures: Array<InstanceType<ThreeModule["Texture"]>> = [];
      const loader = new THREE.TextureLoader();

      const loadTexture = (url: string | null | undefined) => {
        if (!url) return null;
        const texture = loader.load(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        textures.push(texture);
        return texture;
      };

      const denseSurface = bodyMesh.visualHull;
      const multiViewStereo =
        denseSurface?.multiViewStereo;
      const refinedSurface =
        denseSurface?.photometricRefinement;
      const bodyVertices =
        multiViewStereo?.surfaceVertices ??
        refinedSurface?.surfaceVertices ??
        denseSurface?.vertices ??
        bodyMesh.vertices;
      const bodyNormals =
        multiViewStereo?.surfaceNormals ??
        refinedSurface?.surfaceNormals ??
        denseSurface?.normals ??
        bodyMesh.normals;
      const bodyIndices =
        multiViewStereo?.surfaceIndices ??
        denseSurface?.indices ??
        bodyMesh.indices;

      const bodyGeometry = new THREE.BufferGeometry();
      bodyGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(bodyVertices, 3),
      );
      bodyGeometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(bodyNormals, 3),
      );
      bodyGeometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(
          bodyAtlasUvs(
            bodyVertices,
            bodyMesh.boundsCm.height,
            bodyMesh.centerZProfile,
          ),
          2,
        ),
      );
      bodyGeometry.setIndex(bodyIndices);

      let bodyTexture: InstanceType<ThreeModule["Texture"]> | null = null;
      if (bodyCalibration && bodyTextureUrls) {
        try {
          const atlas = await buildBodyTextureAtlas({
            urls: bodyTextureUrls,
            silhouettes: bodyCalibration.silhouettes,
            textureCalibration: bodyCalibration.textureCalibration,
            cameraRig: bodyCalibration.cameraRig,
            optics,
          });
          if (disposed) return;
          const atlasTexture = new THREE.CanvasTexture(atlas);
          atlasTexture.colorSpace = THREE.SRGBColorSpace;
          atlasTexture.anisotropy = 8;
          atlasTexture.wrapS = THREE.RepeatWrapping;
          textures.push(atlasTexture);
          bodyTexture = atlasTexture;
        } catch {
          bodyTexture = null;
        }
      }

      const bodyMaterial = new THREE.MeshPhysicalMaterial({
        map: bodyTexture,
        color: bodyTexture ? 0xffffff : 0xc9b6aa,
        roughness: 0.82,
        metalness: 0,
        sheen: 0.1,
        sheenRoughness: 0.82,
        side: THREE.DoubleSide,
      });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const makeGarmentGeometry = (side: 0 | 1) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(garmentMesh.positions, 3),
        );
        geometry.setAttribute(
          "uv",
          new THREE.Float32BufferAttribute(garmentMesh.uv, 2),
        );
        geometry.setIndex(indicesForSide(garmentMesh, side));
        geometry.computeVertexNormals();
        return geometry;
      };

      const frontGeometry = makeGarmentGeometry(0);
      const backGeometry = makeGarmentGeometry(1);
      const frontTexture = loadTexture(frontTextureUrl);
      const backTexture = loadTexture(backTextureUrl);
      const look = clothLook(fabricWeight, fabricProfile);

      const makeMaterial = (
        texture: InstanceType<ThreeModule["Texture"]> | null,
      ) =>
        new THREE.MeshPhysicalMaterial({
          map: texture,
          color: texture ? 0xffffff : 0x5266ff,
          roughness: look.roughness,
          metalness: 0,
          sheen: look.sheen,
          sheenRoughness: look.sheenRoughness,
          sheenColor: new THREE.Color(0xffffff),
          clearcoat: 0.025,
          clearcoatRoughness: 0.92,
          side: THREE.DoubleSide,
          alphaTest: 0.035,
        });

      const frontMaterial = makeMaterial(frontTexture);
      const backMaterial = makeMaterial(backTexture);
      const frontGarment = new THREE.Mesh(frontGeometry, frontMaterial);
      const backGarment = new THREE.Mesh(backGeometry, backMaterial);
      frontGarment.castShadow = true;
      frontGarment.receiveShadow = true;
      backGarment.castShadow = true;
      backGarment.receiveShadow = true;
      group.add(frontGarment, backGarment);

      const hemi = new THREE.HemisphereLight(0xffffff, 0x48505f, 1.65);
      scene.add(hemi);

      const key = new THREE.DirectionalLight(0xffffff, 3.1);
      key.position.set(height * 0.7, height * 0.85, height * 1.25);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      scene.add(key);

      const fill = new THREE.DirectionalLight(0xe4e8ff, 1.5);
      fill.position.set(-height * 0.85, height * 0.25, height * 0.7);
      scene.add(fill);

      const rim = new THREE.DirectionalLight(0xffffff, 1.15);
      rim.position.set(0, height * 0.65, -height);
      scene.add(rim);

      const floorGeometry = new THREE.PlaneGeometry(height * 2.3, height * 2.3);
      const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0xe8eaee,
        roughness: 0.96,
        metalness: 0,
      });
      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -height / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const heightPx = Math.max(1, host.clientHeight);
        renderer.setSize(width, heightPx, false);
        camera.aspect = width / heightPx;
        camera.updateProjectionMatrix();
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();

      await renderer.init();
      if (disposed) {
        renderer.dispose();
        return;
      }

      renderer.setAnimationLoop(() => {
        renderer.render(scene, camera);
      });

      runtimeRef.current = {
        three: THREE,
        renderer,
        scene,
        camera,
        group,
        frontGeometry,
        backGeometry,
        frontMaterial,
        backMaterial,
        bodyGeometry,
        bodyMaterial,
        textures,
        resizeObserver,
      };

      setBackendLabel(
        "gpu" in navigator ? "WebGPU · PBR" : "WebGL2 fallback · PBR",
      );
      setStatus("ready");
    }

    setup().catch(() => {
      if (!disposed) setStatus("error");
    });

    return () => {
      disposed = true;
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (!runtime) return;
      runtime.renderer.setAnimationLoop(null);
      runtime.resizeObserver.disconnect();
      runtime.frontGeometry.dispose();
      runtime.backGeometry.dispose();
      runtime.bodyGeometry.dispose();
      runtime.frontMaterial.dispose();
      runtime.backMaterial.dispose();
      runtime.bodyMaterial.dispose();
      for (const texture of runtime.textures) texture.dispose();
      runtime.renderer.dispose();
      host.replaceChildren();
    };
  }, [
    bodyMesh,
    garmentMesh,
    frontTextureUrl,
    backTextureUrl,
    bodyCalibration,
    bodyTextureUrls,
    fabricWeight,
    fabricProfile,
    optics,
  ]);

  useEffect(() => {
    void revision;
    const runtime = runtimeRef.current;
    if (!runtime) return;

    for (const geometry of [
      runtime.frontGeometry,
      runtime.backGeometry,
    ]) {
      const position = geometry.getAttribute("position");
      if (
        position.count !== garmentMesh.positions.length / 3 ||
        !("array" in position)
      ) {
        continue;
      }
      const array = position.array as Float32Array;
      array.set(garmentMesh.positions);
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      const normal = geometry.getAttribute("normal");
      if (normal) normal.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
  }, [garmentMesh, revision]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.group.rotation.y = (yawDegrees * Math.PI) / 180;
  }, [yawDegrees, status]);

  return (
    <figure className="relative">
      <div
        ref={hostRef}
        className="aspect-[31/38] w-full overflow-hidden bg-[#f4f5f7]"
      />
      <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-black/10 bg-white/88 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted)] shadow-sm backdrop-blur">
        {status === "ready"
          ? backendLabel
          : status === "error"
            ? "Renderer indisponível"
            : "Inicializando PBR…"}
      </div>
      <figcaption className="border-t border-[var(--line)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
        {bodyCalibration?.version === 10 &&
        bodyMesh.visualHull?.multiViewStereo
          ? "MVS v10: bundle angular/tilt + pirâmide + SIMD, TSDF fusionado, atlas Poisson e PBR."
          : bodyCalibration?.version === 9 &&
              bodyMesh.visualHull?.multiViewStereo
            ? "MVS v9: robust matching + subpixel + eixo compartilhado, TSDF fusionado, atlas Poisson e PBR."
          : bodyCalibration?.version === 8 &&
              bodyMesh.visualHull?.multiViewStereo
            ? "MVS v8: depth maps ZNCC + consistência cruzada + TSDF fusionado, atlas Poisson e PBR."
          : bodyCalibration?.version === 7 &&
              bodyMesh.visualHull?.signedDistanceField
            ? "8-view hull + SDF 3D + atlas multibanda com screened-Poisson, depth buffer e PBR do tecido."
          : bodyMesh.visualHull
            ? "Visual hull denso + atlas corporal multibanda 360°, depth buffer e PBR do tecido."
            : "Atlas corporal multibanda 360° com correção local de cor, depth buffer e PBR do tecido."}
      </figcaption>
    </figure>
  );
}
