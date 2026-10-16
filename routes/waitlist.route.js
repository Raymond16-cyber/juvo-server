import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  joinWaitlist,
  retryWaitlist,
} from "../controllers/waitlist.controller.js";

const waitlistLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many waitlist requests. Please try again shortly." },
});
const waitlistRoutes = Router();

waitlistRoutes.post("/", waitlistLimiter, joinWaitlist);
waitlistRoutes.post("/retry", waitlistLimiter, retryWaitlist);

export default waitlistRoutes;
