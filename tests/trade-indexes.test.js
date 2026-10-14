import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureTradeIndexes } from "../config/tradeIndexes.js";

const keys = { user: 1, source: 1, externalId: 1 };
const options = (source) => ({ unique: true, partialFilterExpression: { source, externalId: { $type: "string" } } });

function fixture(existing = []) {
  const created = [];
  return { created, model: {
    schema: { indexes: () => [[keys, options("ctrader")], [keys, { ...options("metatrader"), name: "metatrader_trade_identity" }]] },
    collection: {
      indexes: async () => existing,
      createIndex: async (key, specification) => { created.push(specification); existing.push({ key, ...specification }); },
    },
  } };
}

for (const name of ["ctrader_trade_identity", "user_1_source_1_externalId_1"]) {
  test(`startup reuses ${name} without dropping or recreating it`, async () => {
    const { model, created } = fixture([{ name, key: keys, ...options("ctrader") }]);
    await ensureTradeIndexes(model);
    assert.equal(created.length, 1);
    assert.equal(created[0].name, "metatrader_trade_identity");
    await ensureTradeIndexes(model);
    assert.equal(created.length, 1);
  });
}

test("fresh database creates both broker uniqueness indexes", async () => {
  const { model, created } = fixture();
  await ensureTradeIndexes(model);
  assert.equal(created.length, 2);
  assert.ok(created.every((index) => index.unique));
});

test("same fields without uniqueness do not count as the required index", async () => {
  const { model, created } = fixture([{ key: keys, ...options("ctrader"), unique: false }]);
  await ensureTradeIndexes(model);
  assert.equal(created.length, 2);
});

test("a concurrent equivalent index creation is accepted, incompatible conflicts still fail", async () => {
  const { model } = fixture([{ key: keys, ...options("metatrader") }]);
  let indexes = await model.collection.indexes();
  model.collection.indexes = async () => indexes;
  model.collection.createIndex = async (key, specification) => {
    indexes = [...indexes, { key, ...specification, name: "created-by-another-process" }];
    throw Object.assign(new Error("same index, different name"), { code: 85 });
  };
  await ensureTradeIndexes(model);
  indexes = [];
  model.collection.createIndex = async () => { throw Object.assign(new Error("incompatible index"), { code: 85 }); };
  await assert.rejects(() => ensureTradeIndexes(model), /incompatible/);
});

test("database permission errors are not swallowed", async () => {
  const { model } = fixture();
  model.collection.indexes = async () => { throw Object.assign(new Error("not authorized"), { code: 13 }); };
  await assert.rejects(() => ensureTradeIndexes(model), { code: 13 });
});
