import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { paystackWebhookController } from "../controllers/billing.controller.js";
import { billingConfig } from "../billing/paystack.config.js";
import {
  initializeCheckout,
  recordRenewalPayment,
  statusFromVerifiedCharge,
  verifyExpectedTransaction,
} from "../services/billing.service.js";
import { paystackClient } from "../billing/paystack.client.js";
import Payment from "../models/Payment.js";
import PaymentWebhookEvent from "../models/PaymentWebhookEvent.js";
import Subscription from "../models/Subscription.js";
import User from "../models/User.js";

const paystackEnv = {
  PAYSTACK_SECRET_KEY: "sk_test_abcdefghijklmnopqrstuvwxyz123456",
  PAYSTACK_BILLING_CURRENCY: "NGN",
  PAYSTACK_PRO_MONTHLY_PLAN_CODE: "PLN_pro_monthly",
  PAYSTACK_SUPER_MONTHLY_PLAN_CODE: "PLN_super_monthly",
  PAYSTACK_CALLBACK_URL: "http://localhost:3000/home/general/subscriptions",
};

function withPaystackEnvironment(t) {
  const prior = Object.fromEntries(
    Object.keys(paystackEnv).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, paystackEnv);
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function successfulTransaction(overrides = {}) {
  return {
    status: "success",
    id: 918273,
    reference: "juvo_1234567890abcdef1234567890abcdef",
    amount: 190000,
    currency: "NGN",
    customer: { email: "trader@example.com" },
    metadata: {
      juvo: {
        userId: "user-1",
        subscriptionId: "subscription-1",
        plan: "pro",
        billingInterval: "monthly",
      },
    },
    ...overrides,
  };
}

const expectedPayment = {
  reference: "juvo_1234567890abcdef1234567890abcdef",
  expectedAmount: 190000,
  currency: "NGN",
  customerEmail: "trader@example.com",
  subscriptionId: "subscription-1",
  plan: "pro",
  billingInterval: "monthly",
};

test("billing configuration requires server-only key, currency, and both plans", () => {
  assert.equal(billingConfig({}).enabled, false);
  const config = billingConfig(paystackEnv);
  assert.equal(config.enabled, true);
  assert.equal(config.mode, "test");
  assert.equal(config.currency, "NGN");
  assert.equal(config.plans.pro.monthly, "PLN_pro_monthly");
});

test("billing configuration selects the matching test or live credentials and plans", () => {
  const config = billingConfig({
    PAYSTACK_MODE: "test",
    PAYSTACK_TEST_SECRET_KEY: "sk_test_testkey123",
    PAYSTACK_BILLING_CURRENCY: "NGN",
    PAYSTACK_TEST_PRO_MONTHLY_PLAN_CODE: "PLN_test_pro",
    PAYSTACK_TEST_SUPER_MONTHLY_PLAN_CODE: "PLN_test_super",
    PAYSTACK_PRO_MONTHLY_PLAN_CODE: "PLN_live_pro",
    PAYSTACK_SUPER_MONTHLY_PLAN_CODE: "PLN_live_super",
  });
  assert.equal(config.mode, "test");
  assert.equal(config.secretKey, "sk_test_testkey123");
  assert.equal(config.plans.pro.monthly, "PLN_test_pro");
  assert.throws(
    () =>
      billingConfig({
        PAYSTACK_MODE: "live",
        PAYSTACK_SECRET_KEY: "sk_test_testkey123",
        PAYSTACK_BILLING_CURRENCY: "NGN",
        PAYSTACK_PRO_MONTHLY_PLAN_CODE: "PLN_live_pro",
        PAYSTACK_SUPER_MONTHLY_PLAN_CODE: "PLN_live_super",
      }),
    { code: "BILLING_UNAVAILABLE" },
  );
});

test("verified payments must match reference, amount, customer, and JUVO metadata", () => {
  assert.equal(
    verifyExpectedTransaction(
      expectedPayment,
      successfulTransaction(),
      "user-1",
    ),
    "918273",
  );
  assert.throws(
    () =>
      verifyExpectedTransaction(
        expectedPayment,
        successfulTransaction({ amount: 1 }),
        "user-1",
      ),
    { code: "PAYMENT_MISMATCH" },
  );
  assert.throws(
    () =>
      verifyExpectedTransaction(
        expectedPayment,
        successfulTransaction({ customer: { email: "other@example.com" } }),
        "user-1",
      ),
    { code: "PAYMENT_EMAIL" },
  );
  assert.throws(
    () =>
      verifyExpectedTransaction(
        expectedPayment,
        successfulTransaction({ metadata: { juvo: { userId: "other-user" } } }),
        "user-1",
      ),
    { code: "PAYMENT_OWNER" },
  );
});

test("a successful charge activates the subscription when Paystack has not attached its subscription object yet", () => {
  assert.equal(statusFromVerifiedCharge(successfulTransaction()), "active");
  assert.equal(
    statusFromVerifiedCharge(
      successfulTransaction({ subscription: { status: "active" } }),
    ),
    "active",
  );
});

test("checkout reads the configured Paystack plan and sends only server-derived values", async (t) => {
  withPaystackEnvironment(t);
  const checkoutCalls = [];
  t.mock.method(User, "findById", () => ({
    select: async () => ({
      _id: "user-1",
      email: "trader@example.com",
      subscription: { plan: "free" },
    }),
  }));
  t.mock.method(Subscription, "find", () => ({ sort: async () => [] }));
  t.mock.method(Subscription, "create", async () => ({
    _id: "subscription-1",
  }));
  t.mock.method(Payment, "create", async () => ({ _id: "payment-1" }));
  t.mock.method(paystackClient, "getPlan", async () => ({
    amount: 190000,
    currency: "NGN",
    interval: "monthly",
  }));
  t.mock.method(paystackClient, "initializeTransaction", async (body) => {
    checkoutCalls.push(body);
    return {
      authorization_url: "https://checkout.paystack.test/authorize",
      reference: body.reference,
    };
  });

  const result = await initializeCheckout({ user: "user-1", plan: "pro" });

  assert.match(result.reference, /^juvo_[a-f0-9]{32}$/);
  assert.equal(
    result.authorizationUrl,
    "https://checkout.paystack.test/authorize",
  );
  assert.deepEqual(checkoutCalls[0].amount, 190000);
  assert.equal(checkoutCalls[0].plan, "PLN_pro_monthly");
  assert.equal(checkoutCalls[0].metadata.juvo.userId, "user-1");
});

test("a non-renewing plan can be replaced by a different plan", async (t) => {
  withPaystackEnvironment(t);
  t.mock.method(User, "findById", () => ({
    select: async () => ({ _id: "user-1", email: "trader@example.com" }),
  }));
  t.mock.method(Subscription, "find", () => ({
    sort: async () => [
      {
        plan: "pro",
        status: "non-renewing",
        currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
      },
    ],
  }));
  t.mock.method(Subscription, "create", async () => ({
    _id: "subscription-super",
  }));
  t.mock.method(Payment, "create", async () => ({ _id: "payment-super" }));
  t.mock.method(paystackClient, "getPlan", async () => ({
    amount: 290000,
    currency: "NGN",
    interval: "monthly",
  }));
  t.mock.method(paystackClient, "initializeTransaction", async (body) => ({
    authorization_url: "https://checkout.paystack.test/authorize",
    reference: body.reference,
  }));

  const result = await initializeCheckout({ user: "user-1", plan: "super" });

  assert.equal(result.plan, "super");
});

test("Paystack webhooks accept only a valid raw-body signature and acknowledge duplicate events", async (t) => {
  withPaystackEnvironment(t);
  t.mock.method(PaymentWebhookEvent, "create", async () => null);
  const rawBody = Buffer.from(
    JSON.stringify({
      event: "charge.success",
      data: { reference: "juvo_1234567890abcdef1234567890abcdef" },
    }),
  );
  const signature = createHmac("sha512", paystackEnv.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");
  const response = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await paystackWebhookController(
    { body: rawBody, get: () => signature },
    response,
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { received: true });

  const rejected = { ...response, statusCode: 0, body: null };
  await paystackWebhookController(
    { body: rawBody, get: () => "not-a-valid-signature" },
    rejected,
  );
  assert.equal(rejected.statusCode, 401);
});

test("a verified renewal charge is added to the owned subscription history", async (t) => {
  const subscription = {
    _id: "subscription-1",
    userId: "user-1",
    plan: "pro",
    billingInterval: "monthly",
    amount: 190000,
    currency: "NGN",
    customerEmail: "trader@example.com",
    paystackPlanCode: "PLN_pro_monthly",
    status: "active",
    currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
  };
  const created = [];
  t.mock.method(Subscription, "findOne", () => ({
    select: async () => subscription,
  }));
  t.mock.method(Subscription, "updateOne", async () => ({
    acknowledged: true,
  }));
  t.mock.method(Subscription, "findById", async () => ({
    ...subscription,
    status: "active",
    currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
  }));
  t.mock.method(Payment, "findOne", async () => null);
  t.mock.method(Payment, "create", async (value) => {
    created.push(value);
    return value;
  });
  t.mock.method(User, "updateOne", async () => ({ acknowledged: true }));

  await recordRenewalPayment(
    successfulTransaction({
      reference: "renewal_123",
      subscription: {
        subscription_code: "SUB_renewal",
        status: "active",
        next_payment_date: "2026-11-01T00:00:00.000Z",
      },
    }),
  );

  assert.equal(created.length, 1);
  assert.equal(created[0].reference, "renewal_123");
  assert.equal(created[0].subscriptionId, "subscription-1");
  assert.equal(created[0].status, "success");
});
