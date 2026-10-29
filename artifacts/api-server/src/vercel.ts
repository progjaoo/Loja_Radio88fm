import { attachDatabasePool } from "@vercel/functions";
import { pool } from "@workspace/db";
import app from "./app";

attachDatabasePool(pool);

export default app;
