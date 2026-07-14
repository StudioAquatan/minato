import { randomUUID } from "node:crypto";
import type { IdGen } from "../ports/index.js";

export const uuidIdGen: IdGen = {
  newId: (prefix: string) => `${prefix}_${randomUUID()}`,
};
