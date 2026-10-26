import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");
const example = await readFile(examplePath, "utf8");
const replitConfig = await readFile(resolve(root, ".replit"), "utf8").catch(() => "");

try {
  await readFile(envPath);
  process.stdout.write(".env already exists; it was left unchanged.\n");
  process.exit(0);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const databaseName = "radio88_local";
const databaseUser = "radio88_local";
const databasePassword = randomBytes(24).toString("hex");
function sharedValue(key) {
  const match = replitConfig.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match?.[1] ?? "";
}

const values = {
  POSTGRES_DB: databaseName,
  POSTGRES_USER: databaseUser,
  POSTGRES_PASSWORD: databasePassword,
  POSTGRES_PORT: "5434",
  DATABASE_URL: `postgresql://${databaseUser}:${databasePassword}@127.0.0.1:5434/${databaseName}`,
  API_HOST: "127.0.0.1",
  VITE_HOST: "127.0.0.1",
  LOCAL_API_PROXY_TARGET: "http://127.0.0.1:8080",
  STORE_EMAIL_FROM: sharedValue("STORE_EMAIL_FROM"),
  R2_S3_ENDPOINT: sharedValue("R2_S3_ENDPOINT"),
  R2_BUCKET_NAME: sharedValue("R2_BUCKET_NAME"),
  R2_PUBLIC_URL: sharedValue("R2_PUBLIC_URL"),
};

let localEnv = example;
for (const [key, value] of Object.entries(values)) {
  const line = new RegExp(`^${key}=.*$`, "m");
  localEnv = localEnv.replace(line, `${key}=${value}`);
}

await writeFile(envPath, localEnv, { mode: 0o600, flag: "wx" });
process.stdout.write("Created ignored .env with a random password for the local PostgreSQL container.\n");
process.stdout.write("External service secrets are blank; add them locally before using those integrations.\n");
