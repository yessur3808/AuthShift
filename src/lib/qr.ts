import { BrowserQRCodeReader } from "@zxing/browser";
import { extractMigrationUris, MigrationError } from "./converter";

type Rectangle = { x: number; y: number; width: number; height: number };

const imageExtensions = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i;

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new MigrationError("This browser does not support image decoding");
  return context;
}

function canvasFromBitmap(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  contextFor(canvas).drawImage(bitmap, 0, 0);
  return canvas;
}

function tryDecode(reader: BrowserQRCodeReader, canvas: HTMLCanvasElement): string | null {
  try {
    const value = reader.decodeFromCanvas(canvas).getText().trim();
    return value || null;
  } catch {
    return null;
  }
}

function rectangleOverlap(first: Rectangle, second: Rectangle): number {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union =
    first.width * first.height + second.width * second.height - intersection;
  return union ? intersection / union : 0;
}

function locateLightSquares(bitmap: ImageBitmap): Rectangle[] {
  const analysisScale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const canvas = makeCanvas(bitmap.width * analysisScale, bitmap.height * analysisScale);
  const context = contextFor(canvas);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixelCount = canvas.width * canvas.height;
  const queue = new Int32Array(pixelCount);
  const rectangles: Rectangle[] = [];

  for (const threshold of [140, 180, 220]) {
    const mask = new Uint8Array(pixelCount);
    for (let index = 0; index < pixelCount; index += 1) {
      const pixel = index * 4;
      const luminance =
        pixels[pixel] * 0.2126 +
        pixels[pixel + 1] * 0.7152 +
        pixels[pixel + 2] * 0.0722;
      mask[index] = luminance >= threshold && pixels[pixel + 3] > 0 ? 1 : 0;
    }

    for (let start = 0; start < pixelCount; start += 1) {
      if (!mask[start]) continue;
      let head = 0;
      let tail = 0;
      let count = 0;
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = 0;
      let maxY = 0;
      queue[tail++] = start;
      mask[start] = 0;

      while (head < tail) {
        const index = queue[head++];
        const x = index % canvas.width;
        const y = Math.floor(index / canvas.width);
        count += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);

        const left = index - 1;
        const right = index + 1;
        const above = index - canvas.width;
        const below = index + canvas.width;
        if (x > 0 && mask[left]) {
          mask[left] = 0;
          queue[tail++] = left;
        }
        if (x + 1 < canvas.width && mask[right]) {
          mask[right] = 0;
          queue[tail++] = right;
        }
        if (y > 0 && mask[above]) {
          mask[above] = 0;
          queue[tail++] = above;
        }
        if (y + 1 < canvas.height && mask[below]) {
          mask[below] = 0;
          queue[tail++] = below;
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      const aspect = width / height;
      const fill = count / (width * height);
      if (
        Math.min(width, height) >= 70 * analysisScale &&
        aspect >= 0.72 &&
        aspect <= 1.28 &&
        fill >= 0.22 &&
        width < canvas.width * 0.98 &&
        height < canvas.height * 0.98
      ) {
        rectangles.push({
          x: minX / analysisScale,
          y: minY / analysisScale,
          width: width / analysisScale,
          height: height / analysisScale,
        });
      }
    }
  }

  return rectangles
    .sort((first, second) => second.width * second.height - first.width * first.height)
    .filter(
      (rectangle, index, all) =>
        all.slice(0, index).every((other) => rectangleOverlap(rectangle, other) < 0.82),
    )
    .slice(0, 8);
}

function renderCrop(
  bitmap: ImageBitmap,
  rectangle: Rectangle,
  scale: number,
  quietZone: boolean,
): HTMLCanvasElement {
  const margin = Math.max(12, Math.round(Math.max(rectangle.width, rectangle.height) * 0.05));
  const sourceX = quietZone ? rectangle.x : Math.max(0, rectangle.x - margin);
  const sourceY = quietZone ? rectangle.y : Math.max(0, rectangle.y - margin);
  const sourceRight = quietZone
    ? rectangle.x + rectangle.width
    : Math.min(bitmap.width, rectangle.x + rectangle.width + margin);
  const sourceBottom = quietZone
    ? rectangle.y + rectangle.height
    : Math.min(bitmap.height, rectangle.y + rectangle.height + margin);
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;
  const padding = quietZone ? margin : 0;
  const canvas = makeCanvas((sourceWidth + padding * 2) * scale, (sourceHeight + padding * 2) * scale);
  const context = contextFor(canvas);
  context.imageSmoothingEnabled = false;
  context.fillStyle = quietZone ? "#ffffff" : "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    padding * scale,
    padding * scale,
    sourceWidth * scale,
    sourceHeight * scale,
  );
  return canvas;
}

function otsuThreshold(source: HTMLCanvasElement): HTMLCanvasElement {
  const output = makeCanvas(source.width, source.height);
  const sourceContext = contextFor(source);
  const outputContext = contextFor(output);
  const image = sourceContext.getImageData(0, 0, source.width, source.height);
  const histogram = new Uint32Array(256);

  for (let index = 0; index < image.data.length; index += 4) {
    const gray = Math.round(
      image.data[index] * 0.2126 +
        image.data[index + 1] * 0.7152 +
        image.data[index + 2] * 0.0722,
    );
    histogram[gray] += 1;
  }

  const total = source.width * source.height;
  let weightedTotal = 0;
  histogram.forEach((count, level) => (weightedTotal += level * count));
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 127;

  for (let level = 0; level < 256; level += 1) {
    backgroundWeight += histogram[level];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += level * histogram[level];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
    const variance =
      backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = level;
    }
  }

  for (let index = 0; index < image.data.length; index += 4) {
    const gray =
      image.data[index] * 0.2126 +
      image.data[index + 1] * 0.7152 +
      image.data[index + 2] * 0.0722;
    const value = gray > threshold ? 255 : 0;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  outputContext.putImageData(image, 0, 0);
  return output;
}

function adaptiveThreshold(source: HTMLCanvasElement): HTMLCanvasElement {
  const output = makeCanvas(source.width, source.height);
  const sourceContext = contextFor(source);
  const image = sourceContext.getImageData(0, 0, source.width, source.height);
  const width = source.width;
  const height = source.height;
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      const pixel = ((y - 1) * width + x - 1) * 4;
      rowSum +=
        image.data[pixel] * 0.2126 +
        image.data[pixel + 1] * 0.7152 +
        image.data[pixel + 2] * 0.0722;
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }

  const radius = 16;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const top = Math.max(0, y - radius);
      const right = Math.min(width - 1, x + radius);
      const bottom = Math.min(height - 1, y + radius);
      const stride = width + 1;
      const sum =
        integral[(bottom + 1) * stride + right + 1] -
        integral[top * stride + right + 1] -
        integral[(bottom + 1) * stride + left] +
        integral[top * stride + left];
      const mean = sum / ((right - left + 1) * (bottom - top + 1));
      const pixel = (y * width + x) * 4;
      const gray =
        image.data[pixel] * 0.2126 +
        image.data[pixel + 1] * 0.7152 +
        image.data[pixel + 2] * 0.0722;
      const value = gray > mean - 5 ? 255 : 0;
      image.data[pixel] = value;
      image.data[pixel + 1] = value;
      image.data[pixel + 2] = value;
      image.data[pixel + 3] = 255;
    }
  }
  contextFor(output).putImageData(image, 0, 0);
  return output;
}

export async function decodeQrImage(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new MigrationError(`${file.name} is not a readable image`);
  }

  const reader = new BrowserQRCodeReader();
  try {
    const direct = tryDecode(reader, canvasFromBitmap(bitmap));
    if (direct) return direct;

    const rectangles = locateLightSquares(bitmap);
    for (const rectangle of rectangles) {
      for (const quietZone of [true, false]) {
        for (const scale of [2, 3, 4]) {
          const crop = renderCrop(bitmap, rectangle, scale, quietZone);
          const rawValue = tryDecode(reader, crop);
          if (rawValue) return rawValue;
          const otsuValue = tryDecode(reader, otsuThreshold(crop));
          if (otsuValue) return otsuValue;
          const adaptiveValue = tryDecode(reader, adaptiveThreshold(crop));
          if (adaptiveValue) return adaptiveValue;
        }
      }
    }
  } finally {
    bitmap.close();
  }

  throw new MigrationError(
    `No readable QR code found in ${file.name}. Use the original screenshot or a lossless PNG.`,
  );
}

export async function extractUrisFromFile(file: File): Promise<string[]> {
  const isImage = file.type.startsWith("image/") || imageExtensions.test(file.name);
  if (isImage) {
    const value = await decodeQrImage(file);
    return value.toLowerCase().startsWith("otpauth-migration://") ? [value] : [];
  }

  const values = extractMigrationUris(await file.text());
  if (!values.length) {
    throw new MigrationError(`${file.name} contains no migration URI`);
  }
  return values;
}
