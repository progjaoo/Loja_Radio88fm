import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
let contents = await readFile(envPath, "utf8");

function readValue(key) {
  const line = contents.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) return undefined;
  const value = line.slice(key.length + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

function setValue(key, value) {
  if (/\r|\n/.test(value)) throw new Error(`${key} must be a single line.`);
  const expression = new RegExp(`^${key}=.*$`, "m");
  if (expression.test(contents)) contents = contents.replace(expression, `${key}=${value}`);
  else contents = `${contents.trimEnd()}\n${key}=${value}\n`;
}

const publishableKey = readValue("CLERK_PUBLISHABLE_KEY") ?? readValue("VITE_CLERK_PUBLISHABLE_KEY");
if (!publishableKey?.startsWith("pk_test_")) {
  throw new Error("A development Clerk publishable key was not found in .env.");
}
setValue("VITE_CLERK_PUBLISHABLE_KEY", publishableKey);

const adminEmail = process.env.LOCAL_STORE_ADMIN_EMAIL?.trim();
if (adminEmail) setValue("STORE_ADMIN_EMAIL", adminEmail);

await writeFile(envPath, contents, { mode: 0o600 });
await chmod(envPath, 0o600);
process.stdout.write("Synchronized the development Clerk publishable key into Vite's local environment.\n");
if (adminEmail) process.stdout.write("Updated STORE_ADMIN_EMAIL in the ignored local .env.\n");
