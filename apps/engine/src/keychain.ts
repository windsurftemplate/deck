/** Same service name as the desktop shell's Rust keychain commands, so both read the same entries. */
export const KEYCHAIN_SERVICE = "dev.deck.app";

export interface Keychain {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service). */
export async function osKeychain(): Promise<Keychain> {
  const { Entry } = await import("@napi-rs/keyring");
  const entry = (name: string) => new Entry(KEYCHAIN_SERVICE, name);
  return {
    async get(name) {
      try {
        return entry(name).getPassword() ?? null;
      } catch {
        return null;
      }
    },
    async set(name, value) {
      entry(name).setPassword(value);
    },
    async remove(name) {
      try {
        entry(name).deletePassword();
      } catch {
        /* already gone */
      }
    },
  };
}

/** For tests and the browser preview. Not persistent, not secure. */
export function memoryKeychain(seed: Record<string, string> = {}): Keychain {
  const m = new Map(Object.entries(seed));
  return {
    get: async (n) => m.get(n) ?? null,
    set: async (n, v) => void m.set(n, v),
    remove: async (n) => void m.delete(n),
  };
}
