import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  activateTradingAccountController,
  createTradingAccountController,
  deleteTradingAccountController,
  getArchivedTradingAccountsController,
  getTradingAccountByIdController,
  getUserTradingAccountsController,
  restoreTradingAccountController,
} from "../controllers/TradingAccount.js";

const tradingAccountRoutes = Router();

tradingAccountRoutes.post("/create-trading-account", requireAuth, createTradingAccountController);
tradingAccountRoutes.get("/get-user-trading-accounts", requireAuth, getUserTradingAccountsController);
tradingAccountRoutes.get("/archived", requireAuth, getArchivedTradingAccountsController);
tradingAccountRoutes.get("/:accountId", requireAuth, getTradingAccountByIdController);
tradingAccountRoutes.patch("/:accountId/activate", requireAuth, activateTradingAccountController);
tradingAccountRoutes.patch("/:accountId/restore", requireAuth, restoreTradingAccountController);
tradingAccountRoutes.delete("/delete-trading-account/:accountId", requireAuth, deleteTradingAccountController);

export default tradingAccountRoutes;
