import StudySet from "../models/StudySet.js";
import Bookmark from "../models/Bookmark.js";

export async function createStudySet(studySetData) {
  const newStudySet = new StudySet({
    title: studySetData.title,
    description: studySetData.description,
    category: studySetData.category,
    author: studySetData.createdBy || null,
    createdBy: studySetData.authorId || null,
    flashcardCount: studySetData.flashcardCount || 0,
    noteCount: studySetData.noteCount || 0,
    accent: studySetData.accent || "#06B6D4",
    rating: studySetData.rating || 0,
    isPublic: studySetData.isPublic !== undefined ? studySetData.isPublic : true,
    quizzes: studySetData.quizzes || [],
  });
  newStudySet.quizCount = newStudySet.quizzes.length; // Set quizCount based on quizzes array length
  return newStudySet.save();
}

export async function countPublicStudySets() {
  return StudySet.countDocuments({ isPublic: true });
}

export async function findPublicStudySets(filter = {}) {
  const sets = await StudySet.find(filter).sort({ createdAt: -1 }).lean();
  return sets;
}

export async function insertSeedStudySets(studySets) {
  return StudySet.insertMany(studySets);
}

export async function findStudySetsByUserId(userId) {
  return StudySet.find({ createdBy: userId }).lean();
}

export async function findBookmark(userId, studySetId) {
  return Bookmark.findOne({ userId, studySetId }).lean();
}

export async function createBookmark(userId, studySetId) {
  return Bookmark.create({ userId, studySetId });
}

export async function deleteBookmark(userId, studySetId) {
  return Bookmark.findOneAndDelete({ userId, studySetId });
}

export async function findBookmarksByUser(userId) {
  return Bookmark.find({ userId })
    .populate({
      path: "studySetId",
      model: "StudySet",
    })
    .sort({ createdAt: -1 })
    .lean();
}
