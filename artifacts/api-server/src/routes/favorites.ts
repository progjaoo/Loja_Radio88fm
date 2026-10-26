import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  AddFavoriteParams,
  AddFavoriteResponse,
  ListFavoritesResponse,
  RemoveFavoriteParams,
  RemoveFavoriteResponse,
} from "@workspace/api-zod";
import { db, favoritesTable } from "@workspace/db";
import { getProductById, getProducts, serializeProduct } from "../lib/serializers";
import { getStoreProfile, requireStoreAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/favorites", requireStoreAuth, async (_req, res): Promise<void> => {
  const profile = getStoreProfile(res);
  const favorites = await db
    .select({ productId: favoritesTable.productId })
    .from(favoritesTable)
    .where(eq(favoritesTable.userId, profile.userId))
    .orderBy(asc(favoritesTable.createdAt));
  const products = await getProducts();
  const byId = new Map(products.map((product) => [product.id, product]));
  res.json(
    ListFavoritesResponse.parse(
      favorites.flatMap((favorite) => {
        const product = byId.get(favorite.productId);
        return product ? [serializeProduct(product)] : [];
      }),
    ),
  );
});

router.put("/favorites/:productId", requireStoreAuth, async (req, res): Promise<void> => {
  const params = AddFavoriteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const product = await getProductById(params.data.productId);
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  await db
    .insert(favoritesTable)
    .values({ userId: profile.userId, productId: product.id })
    .onConflictDoNothing({ target: [favoritesTable.userId, favoritesTable.productId] });
  res.json(AddFavoriteResponse.parse(serializeProduct(product)));
});

router.delete("/favorites/:productId", requireStoreAuth, async (req, res): Promise<void> => {
  const params = RemoveFavoriteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const profile = getStoreProfile(res);
  const [favorite] = await db
    .delete(favoritesTable)
    .where(and(eq(favoritesTable.userId, profile.userId), eq(favoritesTable.productId, params.data.productId)))
    .returning({ id: favoritesTable.id });
  if (!favorite) {
    res.status(404).json({ error: "Favorite not found." });
    return;
  }
  res.status(204).send(RemoveFavoriteResponse.parse(undefined));
});

export default router;
