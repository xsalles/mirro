/// <reference lib="webworker" />

import {
  buildClassicalMultiViewStereo,
  type MultiViewStereoDiagnostics,
} from "../lib/mirro/body-mvs";
import type {
  BodyMvsWorkerResponse,
  BodyMvsWorkerStartMessage,
} from "../lib/mirro/body-mvs-worker-protocol";
import type { BodyMultiViewStereo } from "../lib/mirro/types";

const scope = self as DedicatedWorkerGlobalScope;

function transfersFor(
  result: BodyMultiViewStereo | null,
) {
  if (!result) return [] as Transferable[];
  const buffers = new Set<ArrayBuffer>();

  for (const map of Object.values(result.depthMaps)) {
    buffers.add(map.depthValues.buffer as ArrayBuffer);
    buffers.add(map.confidence.buffer as ArrayBuffer);
  }
  buffers.add(
    result.tsdf.values.buffer as ArrayBuffer,
  );
  buffers.add(
    result.tsdf.weights.buffer as ArrayBuffer,
  );

  return [...buffers];
}

scope.onmessage = (
  event: MessageEvent<BodyMvsWorkerStartMessage>,
) => {
  if (event.data.type !== "build") return;

  const diagnostics: MultiViewStereoDiagnostics = {
    validDepthCount: 0,
    meanConfidence: 0,
    crossViewConsistency: 0,
    surfaceTriangleCount: 0,
    rejection: "none",
  };

  try {
    const result = buildClassicalMultiViewStereo({
      ...event.data.input,
      diagnostics,
    });

    if (result) {
      result.executionBackend =
        result.matchingKernel ===
        "wasm-popcnt32-v1"
          ? "worker-wasm"
          : "worker-js";
    }

    const response: BodyMvsWorkerResponse = {
      type: "done",
      result,
      diagnostics,
    };
    scope.postMessage(
      response,
      transfersFor(result),
    );
  } catch (error) {
    const response: BodyMvsWorkerResponse = {
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Falha desconhecida no worker MVS.",
    };
    scope.postMessage(response);
  }
};

export {};
