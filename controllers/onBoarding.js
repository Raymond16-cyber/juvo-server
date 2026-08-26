import { updateUser } from "../repositories/userRepository.js";
import { validateOnboardingInput } from "../validations/onboardingValidation.js";

function buildOnboardingUpdates(data) {
  const completedAt = new Date();
  const updates = {
    $set: {
      "onboarding.completed": true,
      "onboarding.currentStep": data.currentStep ?? 0,
      "onboarding.completedAt": completedAt,
      lastActiveAt: completedAt,
    },
  };

  if (data.country !== undefined) updates.$set["profile.country"] = data.country;
  if (data.timezone !== undefined) {
    updates.$set["profile.timezone"] = data.timezone;
  }
  if (data.experienceLevel !== undefined) {
    updates.$set["profile.experienceLevel"] = data.experienceLevel;
  }
  if (data.tradingStyle !== undefined) {
    updates.$set["profile.tradingStyle"] = data.tradingStyle;
  }
  if (data.instruments !== undefined) {
    updates.$set["profile.instruments"] = data.instruments;
  }
  if (data.biggestChallenges !== undefined) {
    updates.$set["profile.biggestChallenges"] = data.biggestChallenges;
  }

  if (data.theme !== undefined) updates.$set["preferences.theme"] = data.theme;
  if (data.preferredCurrency !== undefined) {
    updates.$set["preferences.preferredCurrency"] = data.preferredCurrency;
  }
  if (data.weekStartsOn !== undefined) {
    updates.$set["preferences.weekStartsOn"] = data.weekStartsOn;
  }
  if (data.notificationsEnabled !== undefined) {
    updates.$set["preferences.notifications.enabled"] =
      data.notificationsEnabled;
  }
  if (data.reminderTime !== undefined) {
    updates.$set["preferences.notifications.reminderTime"] = data.reminderTime;
  }
  if (data.pushToken !== undefined) {
    updates.$set["preferences.notifications.pushToken"] = data.pushToken;
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
