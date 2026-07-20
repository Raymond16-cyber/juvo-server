import { findUserById,updateUser,findUserByEmail } from "../repositories/userRepository.js";
import { signToken } from "../utils/token.js";
import { validateUpdateUserInfoInput } from "../validations/userValidation.js";

function sanitizeUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function updateUserInfoService(payload) {
    const result = validateUpdateUserInfoInput(payload);
    if (!result.isValid) {
        const error = new Error(result.errors.join(" "));
        error.status = 400;
        throw error;
    }
    const userEmail = await findUserByEmail(payload.email);
    // Proceed with updating user info
    const user = await findUserById(payload.userId);
    console.log(userEmail,user?.email)
    if(user.email !== payload.email && userEmail) {
        const error = new Error("Email is not registered.");
        error.status = 409;
        throw error;
    }
    if (!user) {
        const error = new Error("User not found.");
        error.status = 404;
        throw error;
    }
    const newUserData = await updateUser(payload.userId, payload);

    const token = signToken(newUserData);

    return {
        message: "User information updated successfully.",
        user: sanitizeUser(newUserData),
        token,
    };
    
}


export {
    updateUserInfoService
}