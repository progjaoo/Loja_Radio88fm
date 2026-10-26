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

export function bannerValidationError(banner: BannerConfig): string | null {
  if (banner.slides.length > 8) return "O carrossel pode ter no máximo 8 banners.";
  if (new Set(banner.slides.map(slide => slide.id)).size !== banner.slides.length) {
    return "Cada banner precisa ter um identificador único.";
  }

  for (const slide of banner.slides) {
    if ([slide.imageUrl, slide.mobileImageUrl].some(url => url !== null && !isWebUrl(url))) {
      return "Use uma URL HTTP ou HTTPS válida para cada imagem.";
    }
    if (slide.ctaHref && !isSafeBannerLink(slide.ctaHref)) {
      return "O destino deve ser um caminho do site iniciado com / ou uma URL HTTP/HTTPS.";
    }
    if (banner.enabled && slide.enabled && (!slide.imageUrl || !slide.alt.trim())) {
      return "Para ativar um banner, informe a imagem desktop e o texto alternativo.";
    }
  }

  if (banner.enabled && !banner.slides.some(slide => slide.enabled)) {
    return "Ative pelo menos um banner para exibir o carrossel.";
  }
  return null;
}
