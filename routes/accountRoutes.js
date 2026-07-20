import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { updateUserInfo } from "../controllers/accountController.js";

const accountRoutes = express.Router();

accountRoutes.patch("/update",requireAuth,updateUserInfo);

export default accountRoutes;
