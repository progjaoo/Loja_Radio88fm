type BannerSlide = {
  id: string;
  enabled: boolean;
  title: string;
  description: string;
  imageUrl: string | null;
  mobileImageUrl: string | null;
  alt: string;
  ctaLabel: string;
  ctaHref: string | null;
  mediaType?: "image" | "video";
  videoUrl?: string | null;
  mobileVideoUrl?: string | null;
  posterUrl?: string | null;
  mobilePosterUrl?: string | null;
  imageDurationMs?: number;
};

type BannerConfig = {
  enabled: boolean;
  slides: BannerSlide[];
};

export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isSafeBannerLink(value: string): boolean {
  if (/[\u0000-\u0020\\]/.test(value)) return false;
  return (value.startsWith("/") && !value.startsWith("//")) || isWebUrl(value);
}

export function mergeBannerSlides(previous: readonly BannerSlide[], incoming: readonly BannerSlide[]): BannerSlide[] {
  const previousById = new Map(previous.map(slide => [slide.id, slide]));
  return incoming.map(slide => ({ ...previousById.get(slide.id), ...slide }));
}

export function bannerValidationError(banner: BannerConfig): string | null {
  if (banner.slides.length > 8) return "O carrossel pode ter no máximo 8 banners.";
  if (new Set(banner.slides.map(slide => slide.id)).size !== banner.slides.length) {
    return "Cada banner precisa ter um identificador único.";
  }

  for (const slide of banner.slides) {
    const mediaType = slide.mediaType ?? "image";
    if (![slide.imageUrl, slide.mobileImageUrl, slide.videoUrl, slide.mobileVideoUrl, slide.posterUrl, slide.mobilePosterUrl].every(url => url == null || isWebUrl(url))) {
      return "Use uma URL HTTP ou HTTPS válida para cada mídia.";
    }
    if (slide.imageDurationMs !== undefined && (!Number.isInteger(slide.imageDurationMs) || slide.imageDurationMs < 3000 || slide.imageDurationMs > 15000)) return "O tempo de cada imagem deve ficar entre 3 e 15 segundos.";
    if (slide.ctaHref && !isSafeBannerLink(slide.ctaHref)) {
      return "O destino deve ser um caminho do site iniciado com / ou uma URL HTTP/HTTPS.";
    }
    if (banner.enabled && slide.enabled && !slide.alt.trim()) return "Para ativar um banner, informe o texto alternativo.";
    if (banner.enabled && slide.enabled && mediaType === "image" && !slide.imageUrl) {
      return "Para ativar uma imagem, informe a arte desktop.";
    }
    if (banner.enabled && slide.enabled && mediaType === "video" && (!slide.videoUrl || !slide.posterUrl)) {
      return "Para ativar um vídeo, informe o MP4 desktop e sua imagem de capa.";
    }
  }

  if (banner.enabled && !banner.slides.some(slide => slide.enabled)) {
    return "Ative pelo menos um banner para exibir o carrossel.";
  }
  return null;
}
