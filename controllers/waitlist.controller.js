import {
  joinWaitlistService,
  retryWaitlistInvitation,
  sendWaitlistCampaign,
  unsubscribeWaitlist,
} from "../services/waitlist.service.js";

async function joinWaitlist(req, res, next) {
  try {
    const result = await joinWaitlistService(req.body)
    return res.status(201).json({
      message:
        "You are on the JUVO waitlist. Check your email for your invitation.",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function retryWaitlist(req, res, next) {
  try {
    const result = await retryWaitlistInvitation(req.body);
    return res.status(200).json({
      message: "A new invitation was sent if delivery succeeds.",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function sendCampaign(req, res, next) {
  try {
    const configured = process.env.WAITLIST_CAMPAIGN_TOKEN || "";
    const supplied = req.get("x-waitlist-campaign-token") || "";
    if (!configured || supplied !== configured)
      return res.status(401).json({ message: "Unauthorized." });
    const result = await sendWaitlistCampaign(req.body || {});
    return res.json({ message: "Waitlist campaign processed.", data: result });
  } catch (error) {
    return next(error);
  }
}

async function unsubscribe(req, res, next) {
  try {
    await unsubscribeWaitlist(req.params.token);
    return res
      .status(200)
      .json({
        message: "You have been unsubscribed from JUVO promotional emails.",
      });
  } catch (error) {
    return next(error);
  }
}

export { joinWaitlist, retryWaitlist, sendCampaign, unsubscribe };
