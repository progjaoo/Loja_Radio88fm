import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageDirectory, "../../..");
const migrationsDirectory = resolve(packageDirectory, "../migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((filename) => /^\d+_.+\.sql$/.test(filename))
  .sort();
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required. Run `pnpm env:local` first.");

const target = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost", "::1"].includes(target.hostname) ||
  target.port !== "5434" ||
  target.pathname !== "/radio88_local" ||
  decodeURIComponent(target.username) !== "radio88_local"
) {
  throw new Error("Refusing bootstrap: DATABASE_URL must target radio88_local on 127.0.0.1:5434.");
}

const requiredTables = [
  "products",
  "product_variants",
  "store_profiles",
  "store_roles",
  "store_permissions",
  "store_role_permissions",
  "store_email_outbox",
  "store_fiscal_settings",
  "store_shipping_settings",
  "store_schema_migrations",
];
let client = new Client({ connectionString: databaseUrl });
await client.connect();

async function listPublicTables() {
  const result = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  return result.rows.map((row) => row.table_name);
}

async function getAppliedMigrations() {
  const result = await client.query("SELECT filename FROM store_schema_migrations ORDER BY filename");
  return result.rows.map((row) => row.filename);
}

async function assertEmptyBaselineSchema(tables) {
  const missing = requiredTables.filter((table) => !tables.includes(table));
  if (missing.length) throw new Error(`Refusing bootstrap: database schema is incomplete (${missing.join(", ")}).`);
  for (const table of requiredTables.filter((name) => name !== "store_schema_migrations")) {
    const result = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
    if (result.rows[0].count !== 0) {
      throw new Error(`Refusing bootstrap: ${table} contains data; local baseline only accepts an empty database.`);
    }
  }
}

let tables = await listPublicTables();
if (tables.length === 0) {
  await client.end();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push"], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (push.error) throw push.error;
  if (push.status !== 0) throw new Error(`drizzle-kit push failed with exit code ${push.status ?? "unknown"}.`);
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  tables = await listPublicTables();
}

if (!tables.includes("store_schema_migrations")) {
  throw new Error("Refusing bootstrap: schema migration history table is missing.");
}

let applied = await getAppliedMigrations();
if (applied.length === migrationFiles.length && migrationFiles.every((file, index) => applied[index] === file)) {
  const missing = requiredTables.filter((table) => !tables.includes(table));
  if (missing.length) throw new Error(`Local baseline is marked complete but lacks tables: ${missing.join(", ")}.`);
  const roles = await client.query("SELECT count(*)::int AS count FROM store_roles WHERE is_system = true");
  const permissions = await client.query("SELECT count(*)::int AS count FROM store_permissions");
  const fiscalSettings = await client.query("SELECT count(*)::int AS count FROM store_fiscal_settings WHERE id = 'default'");
  if (roles.rows[0].count < 5 || permissions.rows[0].count < 20 || fiscalSettings.rows[0].count !== 1) {
    throw new Error("Local baseline history exists but system roles, permissions, or fiscal settings are incomplete.");
  }
  process.stdout.write("Local PostgreSQL baseline is ready; no changes were made.\n");
  await client.end();
  process.exit(0);
}
if (applied.length > 0) {
  throw new Error("Refusing bootstrap: migration history is partial or differs from the local baseline.");
}
await assertEmptyBaselineSchema(tables);

const seedTargets = new Set([
  "store_roles",
  "store_permissions",
  "store_role_permissions",
  "store_user_roles",
  "store_fiscal_settings",
]);
const seedStatements = [];
for (const filename of migrationFiles) {
  const contents = await readFile(resolve(migrationsDirectory, filename), "utf8");
  for (const statement of contents.match(/INSERT INTO[\s\S]*?;/gi) ?? []) {
    const match = statement.match(/^INSERT INTO\s+([a-z_]+)/i);
    if (match && seedTargets.has(match[1].toLowerCase())) seedStatements.push(statement);
  }
}

await client.query("BEGIN");
try {
  for (const statement of seedStatements) await client.query(statement);
  for (const filename of migrationFiles) {
    await client.query("INSERT INTO store_schema_migrations (filename) VALUES ($1)", [filename]);
  }

  const roles = await client.query("SELECT count(*)::int AS count FROM store_roles WHERE is_system = true");
  const permissions = await client.query("SELECT count(*)::int AS count FROM store_permissions");
  const fiscalSettings = await client.query("SELECT count(*)::int AS count FROM store_fiscal_settings WHERE id = 'default'");
  if (roles.rows[0].count < 5 || permissions.rows[0].count < 20 || fiscalSettings.rows[0].count !== 1) {
    throw new Error("Local baseline validation failed: expected system roles, permissions, and default fiscal settings.");
  }

  applied = await getAppliedMigrations();
  if (applied.length !== migrationFiles.length) throw new Error("Local baseline migration history is incomplete.");
  await client.query("COMMIT");
  process.stdout.write(`Local PostgreSQL baseline ready (${migrationFiles.length} migration files recorded).\n`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
