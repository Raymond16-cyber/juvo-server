import { verifyToken } from "../utils/token.js";
import { findUserById } from "../repositories/userRepository.js";

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      return res.status(401).json({ message: "Unauthorized." });
    }
    const user = await findUserById(decoded.sub);

    if (!user) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

export { requireAuth };
