#!/usr/bin/env node
// GPL-3.0-only. Generate the standalone companion contract from app validators.
require("ts-node/register/transpile-only");
const fs = require("node:fs");
const path = require("node:path");
const { zodToJsonSchema } = require("zod-to-json-schema");
const { commandSchema } = require("../src/mcp/domain.ts");
const schemas = Object.fromEntries(
  commandSchema.options.map(schema => [
    schema.shape.operation.value,
    zodToJsonSchema(schema.omit({ operation: true }), { $refStrategy: "none" }),
  ]),
);
const target = path.join(__dirname, "../mcp/schemas.json");
if (process.argv.includes("--check")) {
  if (JSON.stringify(JSON.parse(fs.readFileSync(target, "utf8"))) !== JSON.stringify(schemas))
    throw new Error("MCP schemas are stale. Run node scripts/generate-mcp-schemas.cjs and Prettier.");
} else fs.writeFileSync(target, `${JSON.stringify(schemas, null, 2)}\n`);
