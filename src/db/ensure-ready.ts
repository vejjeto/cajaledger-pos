import { type DatabaseContext, getDbContext } from "./index";
import { seedDatabase } from "./seed";

const globalForSeed = globalThis as unknown as {
  __cajaSeedPromise?: Promise<void>;
};

export async function getSeededDbContext(): Promise<DatabaseContext> {
  const ctx = getDbContext();
  if (!globalForSeed.__cajaSeedPromise) {
    globalForSeed.__cajaSeedPromise = seedDatabase(ctx).then(() => undefined);
  }
  await globalForSeed.__cajaSeedPromise;
  return ctx;
}
