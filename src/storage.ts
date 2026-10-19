// The subset of Web Storage we use; localStorage and in-memory fakes both fit.
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
