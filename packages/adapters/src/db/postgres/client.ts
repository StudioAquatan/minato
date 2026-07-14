import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export type CreateDbOptions = {
  connectionString: string;
  poolMax?: number;
};

export const createDb = (opts: CreateDbOptions) => {
  const pool = new Pool({
    connectionString: opts.connectionString,
    max: opts.poolMax ?? 10,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
};

export { schema };
