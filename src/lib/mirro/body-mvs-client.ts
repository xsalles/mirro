import {
  buildClassicalMultiViewStereo,
  type BodyMvsBuildInput,
  type MultiViewStereoDiagnostics,
} from "./body-mvs";
import type {
  BodyMvsWorkerResponse,
  BodyMvsWorkerStartMessage,
} from "./body-mvs-worker-protocol";
import type { BodyMultiViewStereo } from "./types";

function diagnostics(): MultiViewStereoDiagnostics {
  return {
    validDepthCount: 0,
    meanConfidence: 0,
    crossViewConsistency: 0,
    surfaceTriangleCount: 0,
    rejection: "none",
  };
}

function markMainBackend(
  result: BodyMultiViewStereo | null,
) {
  if (!result) return result;
  result.executionBackend =
    result.matchingKernel === "wasm-popcnt32-v1"
      ? "main-wasm"
      : "main-js";
  return result;
}

export async function buildClassicalMultiViewStereoAsync(
  input: Omit<BodyMvsBuildInput, "diagnostics">,
  options?: {
    preferWorker?: boolean;
  },
): Promise<{
  result: BodyMultiViewStereo | null;
  diagnostics: MultiViewStereoDiagnostics;
}> {
  const preferWorker = options?.preferWorker ?? true;

  if (
    !preferWorker ||
    typeof Worker === "undefined"
  ) {
    const state = diagnostics();
    return {
      result: markMainBackend(
        buildClassicalMultiViewStereo({
          ...input,
          diagnostics: state,
        }),
      ),
      diagnostics: state,
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(
      new URL(
        "../../workers/body-mvs.worker.ts",
        import.meta.url,
      ),
      { type: "module" },
    );

    const fallback = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      const state = diagnostics();
      resolve({
        result: markMainBackend(
          buildClassicalMultiViewStereo({
            ...input,
            diagnostics: state,
          }),
        ),
        diagnostics: state,
      });
    };

    worker.onmessage = (
      event: MessageEvent<BodyMvsWorkerResponse>,
    ) => {
      if (settled) return;
      const message = event.data;

      if (message.type === "error") {
        fallback();
        return;
      }

      settled = true;
      worker.terminate();
      resolve({
        result: message.result,
        diagnostics: message.diagnostics,
      });
    };

    worker.onerror = fallback;

    const message: BodyMvsWorkerStartMessage = {
      type: "build",
      input,
    };
    worker.postMessage(message);
  });
}
