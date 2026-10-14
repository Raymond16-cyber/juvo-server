import { isDeepStrictEqual } from "node:util";
import Trade from "../models/Trades.js";

export function matchesTradeIndex(index, keys, options) {
  return isDeepStrictEqual(Object.entries(index.key), Object.entries(keys)) &&
    Boolean(index.unique) === Boolean(options.unique) &&
    Boolean(index.sparse) === Boolean(options.sparse) &&
    isDeepStrictEqual(index.partialFilterExpression, options.partialFilterExpression) &&
    isDeepStrictEqual(index.collation, options.collation);
}

async function readIndexes(collection) {
  try { return await collection.indexes(); }
  catch (error) {
    if (error.code === 26 || error.codeName === "NamespaceNotFound") return [];
    throw error;
  }
}

// Existing deployments may use either MongoDB's generated name or the newer named index.
// Index semantics, not its name, determine whether uniqueness is already protected.
export async function ensureTradeIndexes(model = Trade) {
  let existing = await readIndexes(model.collection);
  for (const [keys, options] of model.schema.indexes()) {
    if (existing.some((index) => matchesTradeIndex(index, keys, options))) continue;
    try { await model.collection.createIndex(keys, options); }
    catch (error) {
      if (![85, 86].includes(error.code)) throw error;
      existing = await readIndexes(model.collection);
      if (!existing.some((index) => matchesTradeIndex(index, keys, options))) throw error;
    }
    existing = await readIndexes(model.collection);
  }
}
