import { Expo } from "expo-server-sdk";

const expo = new Expo();

async function sendWelcomeNotification(pushToken) {
  if (!Expo.isExpoPushToken(pushToken)) {
    return;
  }

  const messages = [
    {
      to: pushToken,
      sound: "default",
      title: "Welcome to MyHub",
      body: "Start your journey...",
      data: { type: "welcome" },
    },
  ];

  const chunks = expo.chunkPushNotifications(messages);

  for (const chunk of chunks) {
    await expo.sendPushNotificationsAsync(chunk);
  }
}

export { sendWelcomeNotification };