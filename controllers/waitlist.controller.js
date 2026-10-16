import {
  joinWaitlistService,
  retryWaitlistInvitation,
} from "../services/waitlist.service.js";

async function joinWaitlist(req, res, next) {
  try {
    const result = await joinWaitlistService(req.body);
    return res
      .status(201)
      .json({
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
    return res
      .status(200)
      .json({
        message: "A new invitation was sent if delivery succeeds.",
        data: result,
      });
  } catch (error) {
    return next(error);
  }
}

export { joinWaitlist, retryWaitlist };
