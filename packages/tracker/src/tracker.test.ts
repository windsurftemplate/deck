import { SqliteMemoryStore } from "@deck/memory";
import { trackerStoreContract } from "./contract.js";
import { InMemoryTrackerStore, SqliteTrackerStore } from "./index.js";

trackerStoreContract("sqlite (shares the memory file)", async () => new SqliteTrackerStore(new SqliteMemoryStore({ path: ":memory:", key: "test-only-not-a-secret", dim: 16 }).connection));
trackerStoreContract("in-memory", async () => new InMemoryTrackerStore());
