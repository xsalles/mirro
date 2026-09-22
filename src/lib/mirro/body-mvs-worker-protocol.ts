import type {
  BodyMvsBuildInput,
  MultiViewStereoDiagnostics,
} from "./body-mvs";
import type { BodyMultiViewStereo } from "./types";

export type BodyMvsWorkerStartMessage = {
  type: "build";
  input: Omit<BodyMvsBuildInput, "diagnostics">;
};

export type BodyMvsWorkerResponse =
  | {
      type: "done";
      result: BodyMultiViewStereo | null;
      diagnostics: MultiViewStereoDiagnostics;
    }
  | {
      type: "error";
      message: string;
    };
