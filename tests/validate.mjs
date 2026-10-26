// Validates every schema, then checks each example against the schema named by its folder:
// tests/examples/<valid|invalid>/<schema>/<case>.json is checked against schemas/v0/<schema>.schema.json.
// Valid examples must pass; invalid ones must fail.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const schemaDir = join(root, "schemas", "v0");
const base = "https://anamorfa.github.io/protocol/schemas/v0/";
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
addFormats(ajv);

const schemaFiles = readdirSync(schemaDir).filter((f) => f.endsWith(".json"));
for (const file of schemaFiles) {
  ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, file), "utf8")));
}
for (const file of schemaFiles) {
  ajv.getSchema(base + file); // compiles the schema, so a broken $ref fails here
  console.log(`schema ok: ${file}`);
}

let failures = 0;
for (const [dir, shouldPass] of [["valid", true], ["invalid", false]]) {
  const examplesDir = join(root, "tests", "examples", dir);
  for (const schema of readdirSync(examplesDir)) {
    const validate = ajv.getSchema(`${base}${schema}.schema.json`);
    if (!validate) {
      failures++;
      console.error(`FAIL no schema for ${dir}/${schema}`);
      continue;
    }
    for (const file of readdirSync(join(examplesDir, schema)).filter((f) => f.endsWith(".json"))) {
      const ok = validate(JSON.parse(readFileSync(join(examplesDir, schema, file), "utf8")));
      if (ok !== shouldPass) {
        failures++;
        console.error(`FAIL ${dir}/${schema}/${file}`, validate.errors ?? "unexpectedly valid");
      } else {
        console.log(`example ok: ${dir}/${schema}/${file}`);
      }
    }
  }
}

process.exit(failures === 0 ? 0 : 1);
