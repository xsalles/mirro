function colorDistance(a: number[], b: number[]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function average(samples: number[][]) {
  const sum = samples.reduce((acc, sample) => [acc[0] + sample[0], acc[1] + sample[1], acc[2] + sample[2]], [0, 0, 0]);
  return sum.map((value) => value / samples.length);
}

export async function removeFlatBackground(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("O navegador não disponibilizou o Canvas 2D.");

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const image = ctx.getImageData(0, 0, width, height);
  const points = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
    [Math.round(width / 2), 2],
    [Math.round(width / 2), height - 3],
  ];

  const samples = points.map(([x, y]) => {
    const safeX = Math.min(width - 1, Math.max(0, x));
    const safeY = Math.min(height - 1, Math.max(0, y));
    const i = (safeY * width + safeX) * 4;
    return [image.data[i], image.data[i + 1], image.data[i + 2]];
  });
  const bg = average(samples);

  const hardThreshold = 42;
  const softThreshold = 86;
  for (let i = 0; i < image.data.length; i += 4) {
    const distance = colorDistance([image.data[i], image.data[i + 1], image.data[i + 2]], bg);
    if (distance <= hardThreshold) image.data[i + 3] = 0;
    else if (distance < softThreshold) image.data[i + 3] = Math.round(255 * ((distance - hardThreshold) / (softThreshold - hardThreshold)));
  }

  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível processar a peça."))), "image/png", 0.96);
  });
}
