"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { deleteMedia, loadState, saveMedia, saveState } from "@/lib/mirro/db";
import type {
  BodyProfile,
  Garment,
  MediaRef,
  MirroState,
  OpticalCalibrationProfile,
} from "@/lib/mirro/types";

const INITIAL: MirroState = { profile: null, garments: [], optics: null };

type MirroContextValue = {
  state: MirroState;
  ready: boolean;
  saveProfile: (profile: BodyProfile, media: Array<{ blob: Blob; ref: MediaRef }>) => Promise<void>;
  addGarment: (garment: Garment, media: Array<{ blob: Blob; ref: MediaRef }>) => Promise<void>;
  removeGarment: (garment: Garment) => Promise<void>;
  saveOptics: (optics: OpticalCalibrationProfile) => Promise<void>;
};

const MirroContext = createContext<MirroContextValue | null>(null);

export function MirroProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MirroState>(INITIAL);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    loadState()
      .then((next) => {
        if (active) setState(next);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const saveProfile = useCallback(async (profile: BodyProfile, media: Array<{ blob: Blob; ref: MediaRef }>) => {
    await Promise.all(media.map((item) => saveMedia(item.blob, item.ref)));
    const next = { ...state, profile };
    await saveState(next);
    setState(next);
  }, [state]);

  const addGarment = useCallback(async (garment: Garment, media: Array<{ blob: Blob; ref: MediaRef }>) => {
    await Promise.all(media.map((item) => saveMedia(item.blob, item.ref)));
    const next = { ...state, garments: [garment, ...state.garments] };
    await saveState(next);
    setState(next);
  }, [state]);

  const removeGarment = useCallback(async (garment: Garment) => {
    const next = { ...state, garments: state.garments.filter((item) => item.id !== garment.id) };
    await deleteMedia([garment.images.front.key, garment.images.back.key]);
    await saveState(next);
    setState(next);
  }, [state]);

  const saveOptics = useCallback(async (optics: OpticalCalibrationProfile) => {
    const next = { ...state, optics };
    await saveState(next);
    setState(next);
  }, [state]);

  const value = useMemo(
    () => ({
      state,
      ready,
      saveProfile,
      addGarment,
      removeGarment,
      saveOptics,
    }),
    [state, ready, saveProfile, addGarment, removeGarment, saveOptics],
  );
  return <MirroContext.Provider value={value}>{children}</MirroContext.Provider>;
}

export function useMirro() {
  const context = useContext(MirroContext);
  if (!context) throw new Error("useMirro deve ser usado dentro de MirroProvider.");
  return context;
}
