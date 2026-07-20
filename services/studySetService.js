import {
  countPublicStudySets,
  findPublicStudySets,
  findStudySetsByUserId,
  insertSeedStudySets,
  findBookmark,
  createBookmark,
  deleteBookmark,
  findBookmarksByUser,
  createStudySet,
} from "../repositories/studySetRepository.js";

const defaultStudySets = [
  {
    title: "Cell Biology",
    description: "Fundamentals of cell structure, organelles, and membrane transport.",
    category: "Science",
    author: "Dr. Smith",
    flashcardCount: 45,
    noteCount: 12,
    accent: "#06B6D4",
    rating: 4.8,
    isPublic: true,
  },
  {
    title: "Genetics",
    description: "DNA, inheritance patterns, gene expression, and biotechnology basics.",
    category: "Science",
    author: "Prof. Johnson",
    flashcardCount: 32,
    noteCount: 8,
    accent: "#0EA5E9",
    rating: 4.6,
    isPublic: true,
  },
  {
    title: "Microbiology",
    description: "Bacteria, viruses, fungi, and immune system interactions.",
    category: "Science",
    author: "Dr. Williams",
    flashcardCount: 29,
    noteCount: 10,
    accent: "#14B8A6",
    rating: 4.7,
    isPublic: true,
  },
  {
    title: "Advanced Calculus",
    description: "Limits, derivatives, integrals, and series for STEM students.",
    category: "Math",
    author: "Dr. Adams",
    flashcardCount: 56,
    noteCount: 18,
    accent: "#3B82F6",
    rating: 4.9,
    isPublic: true,
  },
  {
    title: "English Literature",
    description: "Classic novels, poetry analysis, and literary devices.",
    category: "Literature",
    author: "Prof. Brown",
    flashcardCount: 38,
    noteCount: 15,
    accent: "#F59E0B",
    rating: 4.5,
    isPublic: true,
  },
  {
    title: "World History",
    description: "Major civilizations, wars, revolutions, and modern global events.",
    category: "History",
    author: "Dr. Lee",
    flashcardCount: 42,
    noteCount: 11,
    accent: "#8B5CF6",
    rating: 4.7,
    isPublic: true,
  },
  {
    title: "Computer Science Basics",
    description: "Algorithms, data structures, and programming fundamentals.",
    category: "Computer Science",
    author: "Prof. Chen",
    flashcardCount: 50,
    noteCount: 20,
    accent: "#22C55E",
    rating: 4.8,
    isPublic: true,
  },
  {
    title: "Spanish Vocabulary",
    description: "Common phrases, verbs, and travel vocabulary for beginners.",
    category: "Language",
    author: "Señora Garcia",
    flashcardCount: 64,
    noteCount: 9,
    accent: "#F97316",
    rating: 4.6,
    isPublic: true,
  },
];


async function ensureSeedData() {
  const count = await countPublicStudySets();
  if (count === 0) {
    await insertSeedStudySets(defaultStudySets);
  }
}

function buildStudySetFilter(search, category) {
  const filter = { isPublic: true };
  
  if (search) {
    const regex = new RegExp(search, "i");
    filter.$or = [{ title: regex }, { description: regex }];
  }
  
  if (category && category !== "all") {
    filter.category = category;
  }
  
  return filter;
}




// action services
export async function createStudySetService(userId, studySetData, authorName) {
  const newStudySet = await createStudySet({ ...studySetData, author: authorName,
    createdBy: userId, });
  return newStudySet;
}

export async function getUserStudySetService(userId) {
  const studySets = await findStudySetsByUserId(userId);
  return studySets;
}

export async function getPublicStudySets(userId, search = "", category = "all") {
  await ensureSeedData();

  const filter = buildStudySetFilter(search, category);
  const studySets = await findPublicStudySets(filter);

  const bookmarkedIds = new Set(
    (await findBookmarksByUser(userId)).map((b) => String(b.studySetId?._id || b.studySetId))
  );

  return studySets.map((set) => ({
    ...set,
    isBookmarked: bookmarkedIds.has(String(set._id)),
  }));
}

export async function getBookmarkedStudySets(userId) {
  const bookmarks = await findBookmarksByUser(userId);
  return bookmarks
    .map((b) => b.studySetId)
    .filter(Boolean)
    .map((set) => ({ ...set, isBookmarked: true }));
}

export async function toggleBookmark(userId, studySetId) {
  const existing = await findBookmark(userId, studySetId);

  if (existing) {
    await deleteBookmark(userId, studySetId);
    return { isBookmarked: false };
  }

  await createBookmark(userId, studySetId);
  return { isBookmarked: true };
}
