import type { BodySide, BodyViewId } from "./types";

export const BODY_VIEW_SEQUENCE: BodyViewId[] = [
  "front",
  "frontRight",
  "right",
  "backRight",
  "back",
  "backLeft",
  "left",
  "frontLeft",
];

export const CORE_BODY_SIDES: BodySide[] = [
  "front",
  "right",
  "back",
  "left",
];

export const BODY_VIEW_ANGLE_RAD: Record<BodyViewId, number> = {
  front: 0,
  frontRight: Math.PI / 4,
  right: Math.PI / 2,
  backRight: (Math.PI * 3) / 4,
  back: Math.PI,
  backLeft: (-Math.PI * 3) / 4,
  left: -Math.PI / 2,
  frontLeft: -Math.PI / 4,
};

export const BODY_VIEW_ANGLE_DEG: Record<BodyViewId, number> = {
  front: 0,
  frontRight: 45,
  right: 90,
  backRight: 135,
  back: 180,
  backLeft: 225,
  left: 270,
  frontLeft: 315,
};

export const BODY_VIEW_LABEL: Record<BodyViewId, string> = {
  front: "Frente · 0°",
  frontRight: "Frente-direita · 45°",
  right: "Direita · 90°",
  backRight: "Costas-direita · 135°",
  back: "Costas · 180°",
  backLeft: "Costas-esquerda · 225°",
  left: "Esquerda · 270°",
  frontLeft: "Frente-esquerda · 315°",
};

export function isCoreBodySide(view: BodyViewId): view is BodySide {
  return CORE_BODY_SIDES.includes(view as BodySide);
}
