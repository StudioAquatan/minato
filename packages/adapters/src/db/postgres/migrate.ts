import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

const main = async () => {
  const url =
    process.env.DATABASE_URL ??
    "postgres://minato:minato@localhost:5432/minato";
  const { db, pool } = createDb({ connectionString: url });
  await migrate(db, { migrationsFolder: new URL("../../../drizzle", import.meta.url).pathname });
  await pool.end();
  console.log("migrations applied");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
