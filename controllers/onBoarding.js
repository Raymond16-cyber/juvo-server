import { updateUser } from "../repositories/userRepository.js";
import { validateOnboardingInput } from "../validations/onboardingValidation.js";

function buildOnboardingUpdates(data) {
  const updates = {
    onboarding: {
      completed: true,
      currentStep: data.currentStep ?? 0,
      completedAt: new Date(),
    },
    lastActiveAt: new Date(),
  };

  const profile = {};
  const preferences = {};

  if (data.country !== undefined) profile.country = data.country;
  if (data.timezone !== undefined) profile.timezone = data.timezone;
  if (data.experienceLevel !== undefined) {
    profile.experienceLevel = data.experienceLevel;
  }
  if (data.tradingStyle !== undefined) profile.tradingStyle = data.tradingStyle;
  if (data.instruments !== undefined) profile.instruments = data.instruments;
  if (data.biggestChallenges !== undefined) {
    profile.biggestChallenges = data.biggestChallenges;
  }

  if (data.theme !== undefined) preferences.theme = data.theme;
  if (data.preferredCurrency !== undefined) {
    preferences.preferredCurrency = data.preferredCurrency;
  }
  if (data.weekStartsOn !== undefined) {
    preferences.weekStartsOn = data.weekStartsOn;
  }
  if (
    data.notificationsEnabled !== undefined ||
    data.reminderTime !== undefined ||
    data.pushToken !== undefined
  ) {
    preferences.notifications = {
      ...(data.notificationsEnabled !== undefined
        ? { enabled: data.notificationsEnabled }
        : {}),
      ...(data.reminderTime !== undefined
        ? { reminderTime: data.reminderTime }
        : {}),
      ...(data.pushToken !== undefined ? { pushToken: data.pushToken } : {}),
    };
  }

  if (Object.keys(profile).length > 0) {
    updates.profile = profile;
  }

  if (Object.keys(preferences).length > 0) {
    updates.preferences = preferences;
  }

  return updates;
}

export const onBoardingUser = async (req, res, next) => {
  try {
    const validation = validateOnboardingInput(req.body);

    if (!validation.isValid) {
      return res.status(400).json({
        message: validation.errors.join(" "),
      });
    }

    const updates = buildOnboardingUpdates(validation.data);
    const updatedUser = await updateUser(req.user.id, updates);

    return res.status(200).json({
      message: "Onboarding completed successfully.",
      user: updatedUser,
    });
  } catch (error) {
    return next(error);
  }
};
