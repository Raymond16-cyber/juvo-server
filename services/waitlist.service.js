import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";

import WaitlistInvitation from "../models/WaitlistInvitation.js";
import Waitlist from "../models/Waitlist.js";
import WaitlistCampaignSend from "../models/WaitlistCampaignSend.js";

import {
  sendLaunchAnnouncementEmail,
  sendWaitlistInvitationEmail,
} from "../utils/email.js";

import {
  WAITLIST_INVITATION_TTL_MS,
  WAITLIST_DISCOUNT_PERCENT,
} from "../billing/waitlist.config.js";

import {
  signWaitlistUnsubscribeToken,
  verifyWaitlistUnsubscribeToken,
} from "../utils/token.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const waitlistEmailSender = {
  send: (...args) => sendWaitlistInvitationEmail(...args),
};

// --------------------------------------------------
// Timing diagnostics
// --------------------------------------------------

async function measure(label, operation) {
  const startedAt = performance.now();

  try {
    return await operation();
  } finally {
    console.log(
      `[Waitlist] ${label}: ${Math.round(performance.now() - startedAt)}ms`,
    );
  }
}

// --------------------------------------------------
// Errors and utilities
// --------------------------------------------------

function waitlistError(message, status = 400, code = "WAITLIST_ERROR") {
  return Object.assign(new Error(message), {
    status,
    code,
    safeWaitlist: true,
  });
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function hashCode(code) {
  return createHash("sha256").update(code).digest("hex");
}

function codesMatch(code, hash) {
  if (!hash) return false;

  const received = Buffer.from(hashCode(code), "hex");
  const expected = Buffer.from(hash, "hex");

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

function createCode() {
  return randomBytes(18).toString("base64url").toUpperCase();
}

function createUnsubscribeToken() {
  return randomBytes(24).toString("base64url");
}

function validateInput({ email, name } = {}) {
  const normalizedEmail = normalizeEmail(email);

  if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw waitlistError("Enter a valid email address.", 422, "EMAIL_INVALID");
  }

  return {
    email: normalizedEmail,
    name: String(name || "")
      .trim()
      .slice(0, 120),
  };
}

// --------------------------------------------------
// Invitation delivery
// --------------------------------------------------

async function deliverInvitation(invitation, code) {
  const startedAt = performance.now();

  try {
    await measure("Email provider", () =>
      waitlistEmailSender.send(
        invitation.email,
        invitation.name,
        code,
        invitation.expiresAt,
      ),
    );
  } catch (error) {
    console.error("[Waitlist] Invitation email failed", {
      invitationId: String(invitation._id),
      code: error.code,
      message: error.message,
      elapsedMs: Math.round(performance.now() - startedAt),
    });

    await measure("Mark invitation as failed", () =>
      WaitlistInvitation.updateOne(
        { _id: invitation._id },
        {
          $set: {
            status: "pending",
            "emailDelivery.status": "failed",
            "emailDelivery.failedAt": new Date(),
            "emailDelivery.lastError": "DELIVERY_FAILED",
          },
          $inc: {
            "emailDelivery.retryCount": 1,
          },
        },
      ),
    );

    throw waitlistError(
      "Your signup was saved, but we could not send the invitation email. Please retry shortly.",
      503,
      "EMAIL_DELIVERY_FAILED",
    );
  }

  // Keep database status updates outside the email catch.
  // A database failure here does not necessarily mean the email failed.
  await measure("Mark invitation as sent", () =>
    WaitlistInvitation.updateOne(
      { _id: invitation._id },
      {
        $set: {
          status: "sent",
          "emailDelivery.status": "sent",
          "emailDelivery.sentAt": new Date(),
          "emailDelivery.lastError": null,
        },
      },
    ),
  );

  return { sent: true };
}

// --------------------------------------------------
// Join waitlist
// --------------------------------------------------

async function joinWaitlistService(payload = {}) {
  const input = validateInput(payload);
  const now = new Date();

  console.log("[Waitlist] Signup started");

  // 1. Find an existing waitlist record.
  let waitlist = await measure("Find waitlist user", () =>
    Waitlist.findOne({ email: input.email }).select("+unsubscribeTokenHash"),
  );

  if (waitlist && waitlist.status === "active" && !waitlist.promotionalOptOut) {
    throw waitlistError(
      "This email is already on the JUVO waitlist.",
      409,
      "WAITLIST_EXISTS",
    );
  }

  // 2. Check for a still-valid invitation BEFORE changing
  //    or creating the waitlist record.
  let invitation = await measure("Find invitation", () =>
    WaitlistInvitation.findOne({
      email: input.email,
    }).select("+codeHash +reservedPaymentId +reservationExpiresAt"),
  );

  if (
    invitation &&
    invitation.status !== "expired" &&
    invitation.status !== "revoked" &&
    invitation.expiresAt > now
  ) {
    throw waitlistError(
      "This email is already on the JUVO waitlist.",
      409,
      "WAITLIST_EXISTS",
    );
  }

  // 3. Create or reactivate the waitlist record.
  const unsubscribeToken = createUnsubscribeToken();

  if (!waitlist) {
    waitlist = await measure("Create waitlist user", () =>
      Waitlist.create({
        name: input.name,
        email: input.email,
        joinedAt: now,
        unsubscribeTokenHash: hashCode(unsubscribeToken),
      }),
    );

    console.log("[Waitlist] New waitlist user created", {
      waitlistId: String(waitlist._id),
    });
  } else {
    waitlist.name = input.name || waitlist.name;
    waitlist.status = "active";
    waitlist.promotionalOptOut = false;
    waitlist.unsubscribeTokenHash = hashCode(unsubscribeToken);
    waitlist.unsubscribedAt = null;

    await measure("Reactivate waitlist user", () => waitlist.save());
  }

  // 4. Create a new invitation or reuse an expired/revoked one.
  const code = createCode();
  const issuedAt = now;
  const expiresAt = new Date(now.getTime() + WAITLIST_INVITATION_TTL_MS);

  const values = {
    name: input.name,
    email: input.email,
    waitlistId: waitlist._id,
    codeHash: hashCode(code),
    status: "pending",
    issuedAt,
    expiresAt,
    discountPercent: WAITLIST_DISCOUNT_PERCENT,
    emailDelivery: {
      status: "pending",
      retryCount: invitation?.emailDelivery?.retryCount || 0,
    },
    reservedPaymentId: null,
    reservationExpiresAt: null,
    userId: null,
    subscriptionId: null,
    paymentReference: null,
    redeemedAt: null,
  };

  if (invitation) {
    Object.assign(invitation, values);

    await measure("Save invitation", () => invitation.save());
  } else {
    invitation = await measure("Create invitation", () =>
      WaitlistInvitation.create(values),
    );
  }

  // 5. Link the invitation to the waitlist record.
  await measure("Link invitation to waitlist user", () =>
    Waitlist.updateOne(
      { _id: waitlist._id },
      { $set: { invitationId: invitation._id } },
    ),
  );

  // 6. Deliver the email and update its delivery status.
  //    This still waits for the provider to finish.
  await measure("Complete invitation delivery", () =>
    deliverInvitation(invitation, code),
  );

  console.log("[Waitlist] Signup completed", {
    waitlistId: String(waitlist._id),
  });

  return {
    email: input.email,
    expiresAt,
  };
}

// --------------------------------------------------
// Retry invitation
// --------------------------------------------------

async function retryWaitlistInvitation(payload = {}) {
  const input = validateInput(payload);

  const invitation = await measure("Find retry invitation", () =>
    WaitlistInvitation.findOne({
      email: input.email,
    }).select("+codeHash +reservedPaymentId +reservationExpiresAt"),
  );

  if (!invitation || invitation.status === "redeemed") {
    throw waitlistError(
      "No retryable invitation was found for this email.",
      404,
      "INVITATION_NOT_RETRYABLE",
    );
  }

  if (invitation.expiresAt <= new Date()) {
    throw waitlistError(
      "This invitation has expired and cannot be retried.",
      410,
      "INVITATION_EXPIRED",
    );
  }

  const code = createCode();

  invitation.codeHash = hashCode(code);
  invitation.status = "pending";
  invitation.emailDelivery = {
    status: "pending",
    retryCount: (invitation.emailDelivery?.retryCount || 0) + 1,
  };
  invitation.reservedPaymentId = null;
  invitation.reservationExpiresAt = null;

  await measure("Save retry invitation", () => invitation.save());

  await measure("Deliver retry invitation", () =>
    deliverInvitation(invitation, code),
  );

  return {
    email: input.email,
    expiresAt: invitation.expiresAt,
  };
}

// --------------------------------------------------
// Validate invitation code
// --------------------------------------------------

async function validateInvitationCode({ code, email }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || "")
    .trim()
    .toUpperCase();

  const invitation = await measure("Find invitation for validation", () =>
    WaitlistInvitation.findOne({
      email: normalizedEmail,
    }).select("+codeHash +reservedPaymentId +reservationExpiresAt"),
  );

  if (
    !invitation ||
    invitation.status !== "sent" ||
    invitation.expiresAt <= new Date() ||
    !codesMatch(normalizedCode, invitation.codeHash)
  ) {
    throw waitlistError(
      "The invitation code is invalid or expired.",
      422,
      "INVITATION_INVALID",
    );
  }

  if (
    invitation.reservedPaymentId &&
    invitation.reservationExpiresAt > new Date()
  ) {
    throw waitlistError(
      "This invitation is already being used for a checkout.",
      409,
      "INVITATION_IN_USE",
    );
  }

  return {
    invitation,
    discountPercent: WAITLIST_DISCOUNT_PERCENT,
    expiresAt: invitation.expiresAt,
  };
}

// --------------------------------------------------
// Reserve invitation for checkout
// --------------------------------------------------

async function reserveInvitation({ invitationId, paymentId }) {
  const now = new Date();

  const invitation = await measure("Reserve invitation", () =>
    WaitlistInvitation.findOneAndUpdate(
      {
        _id: invitationId,
        status: "sent",
        expiresAt: { $gt: now },
        $or: [
          { reservedPaymentId: null },
          { reservationExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: {
          reservedPaymentId: paymentId,
          reservationExpiresAt: new Date(Date.now() + 20 * 60 * 1000),
        },
      },
      { new: true },
    ).select("+codeHash +reservedPaymentId +reservationExpiresAt"),
  );

  return invitation;
}

// --------------------------------------------------
// Release invitation reservation
// --------------------------------------------------

async function releaseInvitation(paymentId) {
  await measure("Release invitation reservation", () =>
    WaitlistInvitation.updateOne(
      {
        reservedPaymentId: paymentId,
        status: "sent",
      },
      {
        $set: {
          reservedPaymentId: null,
          reservationExpiresAt: null,
        },
      },
    ),
  );
}

// --------------------------------------------------
// Redeem invitation
// --------------------------------------------------

async function redeemInvitation({
  invitationId,
  paymentId,
  userId,
  subscriptionId,
  paymentReference,
}) {
  const invitation = await measure("Redeem invitation", () =>
    WaitlistInvitation.findOneAndUpdate(
      {
        _id: invitationId,
        status: "sent",
        reservedPaymentId: paymentId,
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          status: "redeemed",
          userId,
          subscriptionId,
          paymentReference,
          redeemedAt: new Date(),
          reservedPaymentId: null,
          reservationExpiresAt: null,
        },
      },
      { new: true },
    ),
  );

  if (!invitation) {
    throw waitlistError(
      "This invitation could not be redeemed.",
      409,
      "INVITATION_REDEMPTION_FAILED",
    );
  }

  return invitation;
}

// --------------------------------------------------
// Unsubscribe
// --------------------------------------------------

async function unsubscribeWaitlist(token) {
  let decoded;

  try {
    decoded = verifyWaitlistUnsubscribeToken(token);
  } catch {
    throw waitlistError(
      "This unsubscribe link is invalid.",
      400,
      "UNSUBSCRIBE_INVALID",
    );
  }

  const waitlist = await measure("Find unsubscribe user", () =>
    Waitlist.findById(decoded.sub),
  );

  if (!waitlist) {
    throw waitlistError(
      "This unsubscribe link is invalid.",
      400,
      "UNSUBSCRIBE_INVALID",
    );
  }

  await measure("Update unsubscribe status", () =>
    Waitlist.updateOne(
      { _id: waitlist._id },
      {
        $set: {
          status: "unsubscribed",
          promotionalOptOut: true,
          unsubscribedAt: new Date(),
        },
      },
    ),
  );

  return { unsubscribed: true };
}

// --------------------------------------------------
// Send waitlist campaign
// --------------------------------------------------

async function sendWaitlistCampaign({
  campaignId,
  kind = "launch",
  launchAt,
  daysAfterLaunch = 0,
}) {
  if (!campaignId || !/^[A-Za-z0-9_-]{1,80}$/.test(campaignId)) {
    throw waitlistError("Campaign id is invalid.", 422, "CAMPAIGN_INVALID");
  }

  const now = new Date();

  if (kind === "reminder") {
    const launchDate = new Date(launchAt || "");
    const dueAt = new Date(
      launchDate.getTime() + Number(daysAfterLaunch) * 24 * 60 * 60 * 1000,
    );

    if (
      !Number.isFinite(launchDate.getTime()) ||
      !Number.isFinite(dueAt.getTime()) ||
      dueAt > now
    ) {
      throw waitlistError(
        "This reminder is not due yet.",
        422,
        "REMINDER_NOT_DUE",
      );
    }
  }

  const waitlists = await measure("Load campaign recipients", () =>
    Waitlist.find({
      status: "active",
      promotionalOptOut: false,
    }).lean(),
  );

  const baseUrl = (
    process.env.CLIENT_URL ||
    process.env.CLIENT_ORIGIN ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  let sent = 0;
  let skipped = 0;

  for (const waitlist of waitlists) {
    const invitation = await measure("Find campaign invitation", () =>
      WaitlistInvitation.findOne({
        waitlistId: waitlist._id,
        status: "sent",
        expiresAt: { $gt: now },
        userId: null,
      }).lean(),
    );

    if (!invitation) {
      skipped += 1;
      continue;
    }

    let campaignSend;

    try {
      campaignSend = await measure("Create campaign send record", () =>
        WaitlistCampaignSend.create({
          campaignId,
          kind,
          waitlistId: waitlist._id,
          invitationId: invitation._id,
          email: waitlist.email,
        }),
      );
    } catch (error) {
      if (error.code === 11000) {
        skipped += 1;
        continue;
      }

      throw error;
    }

    try {
      await measure("Send campaign email", () =>
        sendLaunchAnnouncementEmail({
          email: waitlist.email,
          name: waitlist.name,
          expiresAt: invitation.expiresAt,
          getStartedUrl: `${baseUrl}/auth/register`,
          unsubscribeUrl:
            `${baseUrl}/api/waitlist/unsubscribe/` +
            signWaitlistUnsubscribeToken(waitlist._id),
        }),
      );

      await measure("Mark campaign email as sent", () =>
        WaitlistCampaignSend.updateOne(
          { _id: campaignSend._id },
          {
            $set: {
              status: "sent",
              sentAt: new Date(),
            },
          },
        ),
      );

      sent += 1;
    } catch (error) {
      console.error("[Waitlist] Campaign email failed", {
        campaignId,
        waitlistId: String(waitlist._id),
        code: error.code,
        message: error.message,
      });

      await measure("Mark campaign email as failed", () =>
        WaitlistCampaignSend.updateOne(
          { _id: campaignSend._id },
          {
            $set: {
              status: "failed",
              failedAt: new Date(),
              lastError: "DELIVERY_FAILED",
            },
          },
        ),
      );
    }
  }

  return {
    campaignId,
    kind,
    sent,
    skipped,
  };
}

// --------------------------------------------------
// Exports
// --------------------------------------------------

export {
  joinWaitlistService,
  retryWaitlistInvitation,
  validateInvitationCode,
  reserveInvitation,
  releaseInvitation,
  redeemInvitation,
  sendWaitlistCampaign,
  unsubscribeWaitlist,
};
