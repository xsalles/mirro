const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateImage(file: File, maxMb: number): string | null {
  if (!IMAGE_TYPES.has(file.type)) return "Use uma imagem JPG, PNG ou WebP.";
  if (file.size === 0) return "A imagem está vazia.";
  if (file.size > maxMb * 1024 * 1024) return `A imagem deve ter no máximo ${maxMb} MB.`;
  return null;
}

export function validMeasurement(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max;
}
