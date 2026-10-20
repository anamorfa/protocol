// Validates every schema and checks the example messages against the envelope schema.
// Examples under tests/examples/valid must pass; those under tests/examples/invalid must fail.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const schemaDir = join(root, "schemas", "v0");
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

for (const file of readdirSync(schemaDir).filter((f) => f.endsWith(".json"))) {
  ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, file), "utf8")));
  console.log(`schema ok: ${file}`);
}

const validate = ajv.getSchema(
  "https://anamorfa.github.io/protocol/schemas/v0/envelope.schema.json",
);
let failures = 0;

for (const [dir, shouldPass] of [["valid", true], ["invalid", false]]) {
  const exampleDir = join(root, "tests", "examples", dir);
  for (const file of readdirSync(exampleDir).filter((f) => f.endsWith(".json"))) {
    const ok = validate(JSON.parse(readFileSync(join(exampleDir, file), "utf8")));
    if (ok !== shouldPass) {
      failures++;
      console.error(`FAIL ${dir}/${file}`, validate.errors ?? "unexpectedly valid");
    } else {
      console.log(`example ok: ${dir}/${file}`);
    }
  }
}

process.exit(failures === 0 ? 0 : 1);
