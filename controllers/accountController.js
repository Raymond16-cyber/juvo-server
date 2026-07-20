import { updateUserInfoService } from "../services/accountService.js";



async function updateUserInfo(req, res, next) {
    try {
        const userId = req.user._id;
        const newId = String(userId);
        const result = await updateUserInfoService({ ...req.body, userId: newId });

        if(result.message === "User not found.") {
            return res.status(404).json({ message: "User not found." });
        }
        console.log(result.message);

        return res.status(200).json({
            message: "User information updated successfully.",
            user: result.user,
            token: result.token,
        });
        
    }catch (error) {
        return next(error);
    }
}

export { 
    updateUserInfo
}