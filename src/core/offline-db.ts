import type {
  PaymentMethod,
  ProductRecord,
  StockConflictItem,
} from "@/contracts/schemas";
import Dexie, { type Table } from "dexie";

export type OfflineSaleStatus = "pending" | "syncing" | "conflict";

export interface OfflineSaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
}

export interface PendingSaleRecord {
  id: string;
  idempotencyKey: string;
  paymentMethod: PaymentMethod;
  taxBps: number;
  items: OfflineSaleItem[];
  totalCents: number;
  createdOfflineAt: string;
  status: OfflineSaleStatus;
  attempts: number;
  conflictMessage?: string;
  conflictDetails?: StockConflictItem[];
}

export interface OfflineQueueStore {
  listPending(): Promise<PendingSaleRecord[]>;
  enqueue(record: PendingSaleRecord): Promise<void>;
  updateRecord(id: string, patch: Partial<PendingSaleRecord>): Promise<void>;
  remove(id: string): Promise<void>;
  cacheProducts(items: ProductRecord[]): Promise<void>;
  getCachedProducts(): Promise<ProductRecord[]>;
}

class CajaDexieDb extends Dexie {
  products_cache!: Table<ProductRecord, string>;
  pending_sales!: Table<PendingSaleRecord, string>;

  constructor() {
    super("cajaledger_offline_v1");
    this.version(1).stores({
      products_cache: "id, sku, category, name",
      pending_sales: "id, idempotencyKey, status, createdOfflineAt",
    });
  }
}

export class DexieOfflineStore implements OfflineQueueStore {
  private readonly db: CajaDexieDb;

  constructor() {
    this.db = new CajaDexieDb();
  }

  async listPending(): Promise<PendingSaleRecord[]> {
    return this.db.pending_sales.orderBy("createdOfflineAt").toArray();
  }

  async enqueue(record: PendingSaleRecord): Promise<void> {
    await this.db.pending_sales.put(record);
  }

  async updateRecord(
    id: string,
    patch: Partial<PendingSaleRecord>,
  ): Promise<void> {
    await this.db.pending_sales.update(id, patch);
  }

  async remove(id: string): Promise<void> {
    await this.db.pending_sales.delete(id);
  }

  async cacheProducts(items: ProductRecord[]): Promise<void> {
    await this.db.transaction("rw", this.db.products_cache, async () => {
      await this.db.products_cache.clear();
      if (items.length > 0) {
        await this.db.products_cache.bulkPut(items);
      }
    });
  }

  async getCachedProducts(): Promise<ProductRecord[]> {
    return this.db.products_cache.orderBy("name").toArray();
  }
}

export class MemoryOfflineStore implements OfflineQueueStore {
  private productsCache: ProductRecord[] = [];
  private queue: PendingSaleRecord[] = [];

  async listPending(): Promise<PendingSaleRecord[]> {
    return [...this.queue].sort((a, b) =>
      a.createdOfflineAt.localeCompare(b.createdOfflineAt),
    );
  }

  async enqueue(record: PendingSaleRecord): Promise<void> {
    const idx = this.queue.findIndex((item) => item.id === record.id);
    if (idx >= 0) {
      this.queue[idx] = { ...record };
    } else {
      this.queue.push({ ...record });
    }
  }

  async updateRecord(
    id: string,
    patch: Partial<PendingSaleRecord>,
  ): Promise<void> {
    const idx = this.queue.findIndex((item) => item.id === id);
    const current = this.queue[idx];
    if (idx >= 0 && current) {
      this.queue[idx] = { ...current, ...patch };
    }
  }

  async remove(id: string): Promise<void> {
    this.queue = this.queue.filter((item) => item.id !== id);
  }

  async cacheProducts(items: ProductRecord[]): Promise<void> {
    this.productsCache = items.map((item) => ({ ...item }));
  }

  async getCachedProducts(): Promise<ProductRecord[]> {
    return [...this.productsCache].sort((a, b) => a.name.localeCompare(b.name));
  }
}

let browserStoreSingleton: OfflineQueueStore | null = null;

export function getOfflineStore(): OfflineQueueStore {
  if (
    typeof window === "undefined" ||
    typeof window.indexedDB === "undefined"
  ) {
    if (!browserStoreSingleton) {
      browserStoreSingleton = new MemoryOfflineStore();
    }
    return browserStoreSingleton;
  }
  if (!browserStoreSingleton) {
    browserStoreSingleton = new DexieOfflineStore();
  }
  return browserStoreSingleton;
}
