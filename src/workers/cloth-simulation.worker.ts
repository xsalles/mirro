/// <reference lib="webworker" />

import type {
  ClothWorkerResponse,
  ClothWorkerStartMessage,
} from "../lib/mirro/cloth-worker-protocol";
import { simulateClothStep } from "../lib/mirro/xpbd";

const workerScope = self as DedicatedWorkerGlobalScope;

function send(message: ClothWorkerResponse) {
  workerScope.postMessage(message);
}

workerScope.onmessage = (event: MessageEvent<ClothWorkerStartMessage>) => {
  if (event.data.type !== "start") return;

  const {
    mesh,
    bodyMesh,
    material,
    steps,
    dt,
    iterations,
    snapshotEvery,
  } = event.data;

  try {
    let collisions = 0;
    let selfCollisions = 0;
    let maxDisplacementCm = 0;

    for (let step = 1; step <= steps; step += 1) {
      const result = simulateClothStep({
        mesh,
        bodyMesh,
        material,
        dt,
        iterations,
      });

      collisions += result.collisions;
      selfCollisions += result.selfCollisions;
      maxDisplacementCm = Math.max(
        maxDisplacementCm,
        result.maxDisplacementCm,
      );

      if (step % snapshotEvery === 0 && step < steps) {
        send({
          type: "progress",
          step,
          totalSteps: steps,
          positions: [...mesh.positions],
          collisions,
          selfCollisions,
        });
      }
    }

    send({
      type: "done",
      mesh,
      collisions,
      selfCollisions,
      maxDisplacementCm,
    });
  } catch (error) {
    send({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Falha desconhecida no worker de simulação.",
    });
  }
};

export {};
