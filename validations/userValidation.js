function validateUpdateUserInfoInput(payload) {
    const errors = [];
    if (!payload.userId) {
        errors.push("User ID is required.");
    }
    if (!payload.email) {
        errors.push("Email is required.");
    }
    if (payload.email && !/\S+@\S+\.\S+/.test(payload.email)) {
        errors.push("Email is invalid.");
    }
    return {
        isValid: errors.length === 0,
        errors
    };
}

export { validateUpdateUserInfoInput };