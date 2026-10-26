import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storefrontRouter from "./storefront";
import accountRouter from "./account";
import adminRouter from "./admin";
import adminAccessRouter from "./admin-access";
import adminStockRouter from "./admin-stock";
import storeContentRouter from "./store-content";
import mediaRouter from "./media";
import shippingRouter from "./shipping";
import favoritesRouter from "./favorites";
import guestCheckoutRouter from "./guest-checkout";
import fiscalRouter from "./fiscal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storefrontRouter);
router.use(favoritesRouter);
router.use(guestCheckoutRouter);
router.use(accountRouter);
router.use(adminRouter);
router.use(adminAccessRouter);
router.use(adminStockRouter);
router.use(storeContentRouter);
router.use(mediaRouter);
router.use(shippingRouter);
router.use(fiscalRouter);

export default router;
