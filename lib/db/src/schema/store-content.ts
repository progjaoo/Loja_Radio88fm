import { createInsertSchema } from "drizzle-zod";
import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type HomepageBannerSlideData = {
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

export const homepageBannerTable = pgTable("store_homepage_banner", {
  id: text("id").primaryKey().default("main"),
  enabled: boolean("enabled").notNull().default(false),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url"),
  mobileImageUrl: text("mobile_image_url"),
  alt: text("alt").notNull().default(""),
  ctaLabel: text("cta_label").notNull().default(""),
  ctaHref: text("cta_href"),
  slides: jsonb("slides").$type<HomepageBannerSlideData[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertHomepageBannerSchema = createInsertSchema(homepageBannerTable).omit({ id: true, updatedAt: true });
export type HomepageBannerRow = typeof homepageBannerTable.$inferSelect;
export type InsertHomepageBanner = z.infer<typeof insertHomepageBannerSchema>;
