type Mp4Box = { type: string; start: number; dataStart: number; end: number };

export type StoreVideoMetadata = { width: number; height: number; durationSeconds: number };

export type StoreVideoInspection =
  | { ok: true; metadata: StoreVideoMetadata }
  | { ok: false; message: string };

function matchesOwnedMediaUrl(value: string, publicOrigin: string, appOrigin: string, kind: "video" | "poster"): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) return false;
    const demoPath = kind === "video"
      ? /^\/demo\/homepage\/estrelas-(desktop|mobile)\.mp4$/
      : /^\/demo\/homepage\/estrelas-poster-(desktop|mobile)\.png$/;
    if (url.origin === appOrigin && demoPath.test(url.pathname)) {
      return true;
    }
    if (url.origin !== publicOrigin) return false;
    return kind === "video"
      ? /^\/storefront\/[0-9a-f-]{36}\.mp4$/i.test(url.pathname)
      : /^\/storefront\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(url.pathname);
  } catch { return false; }
}

export function isOwnedHomepageVideoUrl(value: string, publicOrigin: string, appOrigin: string): boolean {
  return matchesOwnedMediaUrl(value, publicOrigin, appOrigin, "video");
}

export function isOwnedHomepagePosterUrl(value: string, publicOrigin: string, appOrigin: string): boolean {
  return matchesOwnedMediaUrl(value, publicOrigin, appOrigin, "poster");
}

function boxes(bytes: Buffer, start: number, end: number): Mp4Box[] | null {
  const result: Mp4Box[] = [];
  let cursor = start;

  while (cursor < end) {
    if (end - cursor < 8) return null;
    const size32 = bytes.readUInt32BE(cursor);
    const type = bytes.toString("ascii", cursor + 4, cursor + 8);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (end - cursor < 16) return null;
      const largeSize = bytes.readBigUInt64BE(cursor + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(largeSize);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - cursor;
    }
    if (size < headerSize || cursor + size > end) return null;
    result.push({ type, start: cursor, dataStart: cursor + headerSize, end: cursor + size });
    cursor += size;
  }

  return cursor === end ? result : null;
}

function childBoxes(bytes: Buffer, parent: Mp4Box): Mp4Box[] | null {
  return boxes(bytes, parent.dataStart, parent.end);
}

function movieDuration(bytes: Buffer, box: Mp4Box): number | null {
  if (box.end - box.dataStart < 20) return null;
  const version = bytes[box.dataStart];
  if (version === 0) {
    const timescale = bytes.readUInt32BE(box.dataStart + 12);
    const duration = bytes.readUInt32BE(box.dataStart + 16);
    return timescale ? duration / timescale : null;
  }
  if (version === 1 && box.end - box.dataStart >= 32) {
    const timescale = bytes.readUInt32BE(box.dataStart + 20);
    const duration = Number(bytes.readBigUInt64BE(box.dataStart + 24));
    return timescale && Number.isFinite(duration) ? duration / timescale : null;
  }
  return null;
}

function trackDimensions(bytes: Buffer, box: Mp4Box): { width: number; height: number } | null {
  if (box.end - box.dataStart < 8) return null;
  const width = bytes.readUInt32BE(box.end - 8) / 65_536;
  const height = bytes.readUInt32BE(box.end - 4) / 65_536;
  return Number.isFinite(width) && Number.isFinite(height) ? { width: Math.round(width), height: Math.round(height) } : null;
}

function handlerType(bytes: Buffer, box: Mp4Box): string | null {
  const offset = box.dataStart + 8;
  return offset + 4 <= box.end ? bytes.toString("ascii", offset, offset + 4) : null;
}

function hasH264SampleEntry(bytes: Buffer, box: Mp4Box): boolean {
  if (box.end - box.dataStart < 8) return false;
  const entries = bytes.subarray(box.dataStart + 8, box.end);
  return entries.includes(Buffer.from("avc1", "ascii")) || entries.includes(Buffer.from("avc3", "ascii"));
}

export function inspectStoreVideo(bytes: Buffer): StoreVideoInspection {
  const topLevel = boxes(bytes, 0, bytes.length);
  if (!topLevel || !topLevel.some(box => box.type === "ftyp")) {
    return { ok: false, message: "O arquivo não é um MP4 válido. Envie um vídeo MP4 com codificação H.264." };
  }

  const movie = topLevel.find(box => box.type === "moov");
  if (!movie) return { ok: false, message: "O MP4 não contém metadados de reprodução válidos." };
  const movieChildren = childBoxes(bytes, movie);
  if (!movieChildren) return { ok: false, message: "O MP4 contém metadados inválidos." };
  const durationBox = movieChildren.find(box => box.type === "mvhd");
  const durationSeconds = durationBox ? movieDuration(bytes, durationBox) : null;
  if (!durationSeconds || durationSeconds <= 0 || durationSeconds > 15) {
    return { ok: false, message: "O vídeo deve ter duração maior que zero e no máximo 15 segundos." };
  }

  const tracks = movieChildren.filter(box => box.type === "trak");
  let videoTrack: StoreVideoMetadata | null = null;
  for (const track of tracks) {
    const trackChildren = childBoxes(bytes, track);
    if (!trackChildren) return { ok: false, message: "O MP4 contém uma faixa inválida." };
    const media = trackChildren.find(box => box.type === "mdia");
    if (!media) continue;
    const mediaChildren = childBoxes(bytes, media);
    if (!mediaChildren) return { ok: false, message: "O MP4 contém metadados de mídia inválidos." };
    const handler = mediaChildren.find(box => box.type === "hdlr");
    const kind = handler ? handlerType(bytes, handler) : null;
    if (kind === "soun") return { ok: false, message: "Remova o áudio do vídeo antes de enviá-lo ao carrossel." };
    if (kind !== "vide") continue;

    const trackHeader = trackChildren.find(box => box.type === "tkhd");
    const dimensions = trackHeader ? trackDimensions(bytes, trackHeader) : null;
    const mediaInfo = mediaChildren.find(box => box.type === "minf");
    const mediaInfoChildren = mediaInfo ? childBoxes(bytes, mediaInfo) : null;
    const sampleTable = mediaInfoChildren?.find(box => box.type === "stbl");
    const sampleTableChildren = sampleTable ? childBoxes(bytes, sampleTable) : null;
    const sampleDescription = sampleTableChildren?.find(box => box.type === "stsd");
    if (!dimensions || !sampleDescription || !hasH264SampleEntry(bytes, sampleDescription)) {
      return { ok: false, message: "Use vídeo H.264 com dimensões de imagem legíveis." };
    }
    videoTrack = { ...dimensions, durationSeconds: Math.round(durationSeconds * 100) / 100 };
    break;
  }

  if (!videoTrack) return { ok: false, message: "O MP4 precisa conter uma faixa de vídeo H.264." };
  if (videoTrack.width < 320 || videoTrack.height < 320 || videoTrack.width > 1920 || videoTrack.height > 1200) {
    return { ok: false, message: "Use vídeo entre 320 × 320 e 1920 × 1200 px." };
  }
  return { ok: true, metadata: videoTrack };
}
