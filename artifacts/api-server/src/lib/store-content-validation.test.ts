import assert from "node:assert/strict";
import test from "node:test";
import { bannerValidationError, isSafeBannerLink, isWebUrl, mergeBannerSlides } from "./store-content-validation.ts";

const slide = {
  id: "slide-1",
  enabled: false,
  title: "",
  description: "",
  imageUrl: null,
  mobileImageUrl: null,
  alt: "",
  ctaLabel: "",
  ctaHref: null,
};

test("disabled carousel accepts an empty slide list", () => {
  assert.equal(bannerValidationError({ enabled: false, slides: [] }), null);
});

test("an enabled slide requires real desktop art and alternative text", () => {
  assert.ok(bannerValidationError({ enabled: true, slides: [{ ...slide, enabled: true }] }));
  assert.ok(bannerValidationError({
    enabled: true,
    slides: [{ ...slide, enabled: true, imageUrl: "https://example.com/banner.jpg" }],
  }));
  assert.equal(bannerValidationError({
    enabled: true,
    slides: [{ ...slide, enabled: true, imageUrl: "https://example.com/banner.jpg", alt: "Produtos oficiais da rádio" }],
  }), null);
});

test("disabled carousel can save unfinished slide drafts", () => {
  assert.equal(bannerValidationError({ enabled: false, slides: [{ ...slide, enabled: true }] }), null);
});

test("carousel media and destinations reject script and credential URLs", () => {
  for (const value of ["javascript:alert(1)", "data:image/png;base64,a", "https://user:password@example.com/a", "file:///etc/passwd"]) {
    assert.equal(isWebUrl(value), false);
    assert.equal(isSafeBannerLink(value), false);
  }
  for (const value of ["//example.com/a", "/\\example.com", "/\nexample.com"]) assert.equal(isSafeBannerLink(value), false);
  assert.equal(isSafeBannerLink("/?categoryId=123"), true);
  assert.equal(isSafeBannerLink("https://example.com/products"), true);
});

test("image links are optional and do not require button text", () => {
  assert.equal(bannerValidationError({ enabled: false, slides: [{ ...slide, ctaHref: "/products" }] }), null);
  assert.ok(bannerValidationError({ enabled: false, slides: [{ ...slide, ctaHref: "javascript:alert(1)" }] }));
});

test("legacy CTA labels do not affect photo-only slide validation", () => {
  assert.equal(bannerValidationError({
    enabled: false,
    slides: [{ ...slide, ctaLabel: "Conhecer" }],
  }), null);
});

test("legacy slides default to image media and retain a valid image duration", () => {
  assert.equal(bannerValidationError({ enabled: true, slides: [{ ...slide, enabled: true, imageUrl: "https://example.com/banner.png", alt: "Arte da rádio" }] }), null);
  assert.ok(bannerValidationError({ enabled: false, slides: [{ ...slide, imageDurationMs: 2500 }] }));
  assert.equal(bannerValidationError({ enabled: false, slides: [{ ...slide, imageDurationMs: 15000 }] }), null);
});

test("video slides require an MP4 URL and poster only when published", () => {
  const videoDraft = { ...slide, enabled: true, mediaType: "video" as const };
  assert.equal(bannerValidationError({ enabled: false, slides: [videoDraft] }), null);
  assert.ok(bannerValidationError({ enabled: true, slides: [{ ...videoDraft, alt: "Estrelas" }] }));
  assert.equal(bannerValidationError({ enabled: true, slides: [{ ...videoDraft, videoUrl: "https://cdn.example.com/hero.mp4", posterUrl: "https://cdn.example.com/hero.png", alt: "Estrelas" }] }), null);
  assert.ok(bannerValidationError({ enabled: false, slides: [{ ...videoDraft, mobileVideoUrl: "javascript:alert(1)" }] }));
});

test("legacy clients preserve video fields they omit and may clear them explicitly", () => {
  const current = { ...slide, mediaType: "video" as const, videoUrl: "https://cdn.example.com/hero.mp4", posterUrl: "https://cdn.example.com/hero.png" };
  const legacy = { ...slide, title: "Atualização pelo cliente antigo" };
  const preserved = mergeBannerSlides([current], [legacy]);
  assert.equal(preserved[0].mediaType, "video");
  assert.equal(preserved[0].videoUrl, current.videoUrl);
  const cleared = mergeBannerSlides([current], [{ ...legacy, mediaType: "image", videoUrl: null, posterUrl: null }]);
  assert.equal(cleared[0].mediaType, "image");
  assert.equal(cleared[0].videoUrl, null);
});

test("an enabled carousel needs at least one enabled slide, no duplicate IDs, and at most eight slides", () => {
  assert.ok(bannerValidationError({ enabled: true, slides: [] }));
  assert.ok(bannerValidationError({ enabled: true, slides: [{ ...slide, id: "same" }, { ...slide, id: "same" }] }));
  assert.ok(bannerValidationError({ enabled: false, slides: Array.from({ length: 9 }, (_, i) => ({ ...slide, id: `slide-${i}` })) }));
});
