import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  GetHomepageBannerResponse, UpdateHomepageBannerBody, UpdateHomepageBannerResponse,
  UpdateCategoryBody, UpdateCategoryParams, UpdateCategoryResponse,
  GetHomepageLayoutResponse, UpdateHomepageLayoutBody, UpdateHomepageLayoutResponse,
} from "@workspace/api-zod";
import { auditEventsTable, categoriesTable, db, homepageBannerTable, homepageLayoutTable, productsTable } from "@workspace/db";
import { getStoreProfile, requireStoreAuth, requireStorePermission } from "../middlewares/auth";
import { bannerValidationError } from "../lib/store-content-validation";
import { isSafeBannerLink } from "../lib/store-content-validation";
import { defaultHomepageLayout, homepageSectionsValid } from "../lib/homepage-layout";

const router: IRouter = Router();
router.get("/homepage-layout", async (_req, res): Promise<void> => {
  const [row] = await db.select().from(homepageLayoutTable).where(eq(homepageLayoutTable.id, "main")).limit(1);
  res.json(GetHomepageLayoutResponse.parse(row?.config ?? defaultHomepageLayout));
});

router.put("/admin/homepage-layout", requireStoreAuth, requireStorePermission("content:manage"), async (req, res): Promise<void> => {
  const parsed = UpdateHomepageLayoutBody.safeParse(req.body);
  if (!parsed.success || !homepageSectionsValid(parsed.data.sections) || !parsed.data.hero.title.trim() ||
      !parsed.data.hero.ctaLabel.trim() || !(isSafeBannerLink(parsed.data.hero.ctaHref) || /^#[A-Za-z0-9_-]+$/.test(parsed.data.hero.ctaHref))) {
    res.status(400).json({ error: "Revise as seções e o destino do botão. Mantenha pelo menos uma seção visível." }); return;
  }
  const config = parsed.data;
  const categories = await db.select({ id: categoriesTable.id }).from(categoriesTable);
  const products = await db.select({ id: productsTable.id }).from(productsTable);
  const categoryIds = new Set(categories.map(category => category.id));
  const productIds = new Set(products.map(product => product.id));
  if (config.sections.some(section => section.categoryIds.some(id => !categoryIds.has(id)) || section.productIds.some(id => !productIds.has(id)) ||
      new Set(section.categoryIds).size !== section.categoryIds.length || new Set(section.productIds).size !== section.productIds.length)) {
    res.status(400).json({ error: "Uma categoria ou produto selecionado não existe ou está repetido." }); return;
  }
  const actor = getStoreProfile(res);
  await db.transaction(async tx => {
    await tx.insert(homepageLayoutTable).values({ id: "main", config }).onConflictDoUpdate({
      target: homepageLayoutTable.id, set: { config, updatedAt: new Date() },
    });
    await tx.insert(auditEventsTable).values({ actorId: actor.userId, actorName: actor.fullName, action: "homepage.layout.updated",
      entityType: "homepage_layout", entityId: "main", details: { sections: config.sections.map(section => ({ id: section.id, enabled: section.enabled })) } });
  });
  res.json(UpdateHomepageLayoutResponse.parse(config));
});
const defaultBanner = {
  enabled: false,
  title: "A sua rádio, mais perto de você.",
  description: "Conheça a loja oficial da Rádio 88 FM.",
  imageUrl: null, mobileImageUrl: null, alt: "", ctaLabel: "", ctaHref: null,
  slides: [],
};

router.get("/homepage-banner", async (_req, res): Promise<void> => {
  const [banner] = await db.select().from(homepageBannerTable).where(eq(homepageBannerTable.id, "main")).limit(1);
  res.json(GetHomepageBannerResponse.parse(banner ?? defaultBanner));
});

router.put("/admin/homepage-banner", requireStoreAuth, requireStorePermission("content:manage"), async (req, res): Promise<void> => {
  const parsed = UpdateHomepageBannerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const error = bannerValidationError(parsed.data);
  if (error) { res.status(400).json({ error }); return; }
  const actor = getStoreProfile(res);
  const representativeSlide = parsed.data.slides.find(slide => slide.enabled) ?? parsed.data.slides[0];
  const banner = await db.transaction(async tx => {
    const [saved] = await tx.insert(homepageBannerTable)
      .values({
        id: "main",
        enabled: parsed.data.enabled,
        slides: parsed.data.slides,
        title: representativeSlide?.title ?? "",
        description: representativeSlide?.description ?? "",
        imageUrl: representativeSlide?.imageUrl ?? null,
        mobileImageUrl: representativeSlide?.mobileImageUrl ?? null,
        alt: representativeSlide?.alt ?? "",
        ctaLabel: representativeSlide?.ctaLabel ?? "",
        ctaHref: representativeSlide?.ctaHref ?? null,
      })
      .onConflictDoUpdate({
        target: homepageBannerTable.id,
        set: {
          enabled: parsed.data.enabled,
          slides: parsed.data.slides,
          title: representativeSlide?.title ?? "",
          description: representativeSlide?.description ?? "",
          imageUrl: representativeSlide?.imageUrl ?? null,
          mobileImageUrl: representativeSlide?.mobileImageUrl ?? null,
          alt: representativeSlide?.alt ?? "",
          ctaLabel: representativeSlide?.ctaLabel ?? "",
          ctaHref: representativeSlide?.ctaHref ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    await tx.insert(auditEventsTable).values({
      actorId: actor.userId, actorName: actor.fullName, action: "homepage.banner.updated",
      entityType: "homepage_banner", entityId: "main",
      details: { enabled: parsed.data.enabled, activeSlides: parsed.data.slides.filter(slide => slide.enabled).length },
    });
    return saved;
  });
  res.json(UpdateHomepageBannerResponse.parse(banner));
});

router.patch("/admin/categories/:categoryId", requireStoreAuth, requireStorePermission("categories:manage"), async (req, res): Promise<void> => {
  const params = UpdateCategoryParams.safeParse(req.params);
  const parsed = UpdateCategoryBody.safeParse(req.body);
  if (!params.success || !parsed.success || !Object.keys(parsed.data).length) {
    res.status(400).json({ error: "Informe uma categoria válida e ao menos um campo para alterar." }); return;
  }
  const actor = getStoreProfile(res);
  const category = await db.transaction(async tx => {
    const [saved] = await tx.update(categoriesTable).set(parsed.data)
      .where(eq(categoriesTable.id, params.data.categoryId)).returning();
    if (saved) await tx.insert(auditEventsTable).values({
      actorId: actor.userId, actorName: actor.fullName, action: "category.updated",
      entityType: "category", entityId: saved.id, details: { fields: Object.keys(parsed.data) },
    });
    return saved;
  });
  if (!category) { res.status(404).json({ error: "Categoria não encontrada." }); return; }
  res.json(UpdateCategoryResponse.parse(category));
});

export default router;
