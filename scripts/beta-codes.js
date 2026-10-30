#!/usr/bin/env node
/**
 * JUVO private beta tester code CLI.
 *
 * Examples:
 *   npm run beta:codes:create -- --count 10 --expires-in-days 7
 *   npm run beta:codes:create -- --count 1 --email tester@example.com
 *   npm run beta:codes:list
 *   npm run beta:codes:revoke -- --id <codeObjectId>
 *   npm run beta:admin:promote -- --email owner@example.com
 */
import "../config/loadEnv.js";
import mongoose from "mongoose";
import connectDb from "../config/db.js";
import User from "../models/User.js";
import {
  createTesterCodes,
  listTesterCodes,
  revokeTesterCode,
} from "../services/betaAccess.service.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(part);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
JUVO beta tester codes

Commands:
  create   Generate plaintext codes (shown once)
  list     List code metadata (never shows usable codes)
  revoke   Revoke a code by MongoDB id
  promote-admin  Set role=admin for an email

Options for create:
  --count <n>              Number of codes (default 1, max 100)
  --expires-in-days <n>    Code expiry before redemption
  --max-redemptions <n>    Default 1 (single-use)
  --email <addr>           Bind codes to one email
  --note <text>            Internal note
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || (args.help ? "help" : "");

  if (!command || command === "help" || args.help) {
    printHelp();
    process.exit(0);
  }

  await connectDb();

  try {
    if (command === "create") {
      const created = await createTesterCodes({
        count: args.count,
        expiresInDays: args["expires-in-days"],
        maxRedemptions: args["max-redemptions"],
        boundEmail: args.email || null,
        note: args.note || "",
        createdBy: "cli",
      });

      console.log(`\nCreated ${created.length} tester code(s). Copy now — plaintext is not stored.\n`);
      for (const row of created) {
        console.log(row.code);
        console.log(
          `  id=${row.id} hint=...${row.codeHint} max=${row.maxRedemptions}` +
            (row.boundEmail ? ` email=${row.boundEmail}` : "") +
            (row.expiresAt ? ` expires=${row.expiresAt.toISOString()}` : ""),
        );
      }
      console.log("");
    } else if (command === "list") {
      const rows = await listTesterCodes({ limit: args.limit || 50 });
      if (!rows.length) {
        console.log("No tester codes found.");
      } else {
        for (const row of rows) {
          console.log(
            `${row.id}  ...${row.codeHint}  ${row.status}  used=${row.redemptionCount}/${row.maxRedemptions}` +
              (row.boundEmail ? `  ${row.boundEmail}` : "") +
              (row.expiresAt ? `  codeExpires=${new Date(row.expiresAt).toISOString()}` : ""),
          );
          for (const redemption of row.redemptions || []) {
            console.log(
              `    redeemed by ${redemption.userId} ${redemption.email || ""} at ${redemption.redeemedAt}`,
            );
          }
        }
      }
    } else if (command === "revoke") {
      const id = args.id || args._[1];
      if (!id) {
        console.error("Provide --id <codeObjectId>");
        process.exitCode = 1;
      } else {
        const result = await revokeTesterCode(id, args.reason || "revoked via cli");
        console.log(result.success ? "Revoked." : result.message);
        if (!result.success) process.exitCode = 1;
      }
    } else if (command === "promote-admin") {
      const email = String(args.email || args._[1] || "")
        .trim()
        .toLowerCase();
      if (!email) {
        console.error("Provide --email <address>");
        process.exitCode = 1;
      } else {
        const user = await User.findOneAndUpdate(
          { email },
          { $set: { role: "admin" } },
          { new: true },
        ).select("email role");
        if (!user) {
          console.error("User not found.");
          process.exitCode = 1;
        } else {
          console.log(`Promoted ${user.email} to role=${user.role}`);
        }
      }
    } else {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
    }
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
