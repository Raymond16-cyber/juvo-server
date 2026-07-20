import {
  getPublicStudySets,
  getBookmarkedStudySets,
  toggleBookmark,
  getUserStudySetService,
} from "../services/studySetService.js";


export async function getUserStudySets(req, res, next) {
  try {
    const userId = String(req.user._id);
    const studySets = await getUserStudySetService(userId);
    return res.status(200).json({
      message: "User study sets retrieved successfully.",
      studySets: studySets,
     });
  } catch (error) {
    return next(error);
  }
}

export async function listStudySets(req, res, next) {
  try {
    const userId = String(req.user._id);
    const { search = "", category = "all" } = req.query;

    const studySets = await getPublicStudySets(userId, search, category);

    return res.status(200).json({ studySets });
  } catch (error) {
    return next(error);
  }
}

export async function listBookmarks(req, res, next) {
  try {
    const userId = String(req.user._id);
    const studySets = await getBookmarkedStudySets(userId);

    return res.status(200).json({ studySets });
  } catch (error) {
    return next(error);
  }
}

export async function bookmarkStudySet(req, res, next) {
  try {
    const userId = String(req.user._id);
    const { id } = req.params;
    
    console.log(`User ${userId} is toggling bookmark for study set ${id}`);

    const result = await toggleBookmark(userId, id);
    console.log("Bookmark result:", result);

    return res.status(200).json({
      message: result.isBookmarked ? "Saved to library." : "Removed from library.",
      studySetId: id,
      isBookmarked: result.isBookmarked,
    });
  } catch (error) {
    return next(error);
  }
}
