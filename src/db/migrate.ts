import { logger } from "../lib/logger";
import { getDbContext } from "./index";

const { sqlite } = getDbContext();
const countRow = sqlite
  .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'")
  .get();
logger.info(
  { tables: Number(countRow?.count ?? 0) },
  "CajaLedger migrations applied successfully",
);
