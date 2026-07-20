import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  listStudySets,
  listBookmarks,
  bookmarkStudySet,
  getUserStudySets,
} from "../controllers/studySetController.js";

const studySetRoutes = express.Router();

studySetRoutes.get("/", requireAuth, listStudySets);
studySetRoutes.get("/bookmarks", requireAuth, listBookmarks);
studySetRoutes.post("/:id/bookmark", requireAuth, bookmarkStudySet);
studySetRoutes.get("/get-user-study-sets", requireAuth, getUserStudySets);

export default studySetRoutes;
