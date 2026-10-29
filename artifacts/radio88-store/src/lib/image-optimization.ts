const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
// Leave room under Vercel Functions' 4.5 MB request body limit.
const MAX_R2_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 30_000_000;
const WEBP_QUALITIES = [0.86, 0.78, 0.7, 0.62, 0.54] as const;
const SUPPORTED_SOURCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const OUTPUT_TYPES = ['image/webp', 'image/avif'] as const;

export class ImageOptimizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageOptimizationError';
  }
}

function encodeImage(canvas: HTMLCanvasElement, type: (typeof OUTPUT_TYPES)[number], quality: number): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        // Some browsers report an unsupported encoder (for example AVIF) as
        // a null blob. Keep trying the other output format instead of failing
        // the entire upload.
        resolve(null);
        return;
      }
      resolve(blob.type === type ? blob : null);
    }, type, quality);
  });
}

export async function optimizeImageForR2(file: File): Promise<File> {
  if (!SUPPORTED_SOURCE_TYPES.has(file.type)) {
    throw new ImageOptimizationError('Escolha uma imagem JPG, PNG, WebP ou AVIF.');
  }
  if (file.size < 1 || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new ImageOptimizationError('A imagem original deve ter entre 1 byte e 20 MB.');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new ImageOptimizationError('Este navegador não consegue preparar a imagem. Atualize o navegador e tente novamente.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageOptimizationError('Não foi possível abrir esta imagem. Tente exportá-la como JPG, PNG, WebP ou AVIF.');
  }

  const canvas = document.createElement('canvas');
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      throw new ImageOptimizationError('A imagem deve ter no máximo 30 megapixels para ser otimizada com segurança.');
    }

    let scale = 1;
    let qualityIndex = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new ImageOptimizationError('Não foi possível preparar a imagem neste navegador.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);

      const quality = WEBP_QUALITIES[qualityIndex] ?? 0.54;
      const [webp, avif] = await Promise.all([
        encodeImage(canvas, 'image/webp', quality),
        encodeImage(canvas, 'image/avif', Math.min(0.95, quality + 0.08)),
      ]);
      const candidates = [webp, avif]
        .filter((blob): blob is Blob => blob !== null)
        .map(blob => ({ blob, type: blob.type }));
      if ((file.type === 'image/webp' || file.type === 'image/avif') && file.size <= MAX_R2_IMAGE_BYTES) {
        candidates.push({ blob: file, type: file.type });
      }
      candidates.sort((left, right) => left.blob.size - right.blob.size);
      const best = candidates.find(candidate => candidate.blob.size <= MAX_R2_IMAGE_BYTES);
      if (best) {
        const baseName = file.name.replace(/\.[^.]+$/, '').trim() || 'imagem';
        const extension = best.type === 'image/avif' ? 'avif' : 'webp';
        return new File([best.blob], `${baseName}.${extension}`, { type: best.type, lastModified: file.lastModified });
      }
      if (candidates.length === 0) {
        throw new ImageOptimizationError('Este navegador não conseguiu gerar WebP nem AVIF. Atualize o navegador e tente novamente.');
      }

      if (qualityIndex < WEBP_QUALITIES.length - 1) qualityIndex += 1;
      else {
        scale *= 0.85;
        qualityIndex = 2;
      }
    }

    throw new ImageOptimizationError('A imagem otimizada ainda excede 4 MiB. Reduza suas dimensões e tente novamente.');
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
