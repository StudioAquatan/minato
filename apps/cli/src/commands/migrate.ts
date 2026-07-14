import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "@minato/adapters/db";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const migrateCommand = async (): Promise<void> => {
  const url =
    process.env.DATABASE_URL ??
    "postgres://minato:minato@localhost:5432/minato";
  const { db, pool } = createDb({ connectionString: url });
  const migrationsFolder = resolve(
    here,
    "../../../../packages/adapters/drizzle",
  );
  console.log(`applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log("migrations applied.");
};
