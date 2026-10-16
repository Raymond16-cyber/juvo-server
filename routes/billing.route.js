import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  cancelSubscriptionController,
  getBillingController,
  initializeCheckoutController,
  managementLinkController,
  reconcileBillingController,
  validateBillingInvitationController,
  verifyPaymentController,
} from "../controllers/billing.controller.js";

const billingRoutes = Router();
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many checkout requests. Please try again shortly." },
});
const billingActionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many billing requests. Please try again shortly." },
});

billingRoutes.get("/", requireAuth, getBillingController);
billingRoutes.post(
  "/checkout",
  requireAuth,
  checkoutLimiter,
  initializeCheckoutController,
);
billingRoutes.post(
  "/invitation/validate",
  requireAuth,
  billingActionLimiter,
  validateBillingInvitationController,
);
billingRoutes.post(
  "/verify",
  requireAuth,
  billingActionLimiter,
  verifyPaymentController,
);
billingRoutes.post(
  "/reconcile",
  requireAuth,
  billingActionLimiter,
  reconcileBillingController,
);
billingRoutes.post(
  "/subscriptions/:subscriptionId/cancel",
  requireAuth,
  billingActionLimiter,
  cancelSubscriptionController,
);
billingRoutes.post(
  "/subscriptions/:subscriptionId/manage",
  requireAuth,
  billingActionLimiter,
  managementLinkController,
);

export default billingRoutes;
