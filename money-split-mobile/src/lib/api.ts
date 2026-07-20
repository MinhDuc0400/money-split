// Stub for Task 2 — Task 3 will replace this with the real implementation
export const api = {
  get: <T>(_url: string): Promise<T> => Promise.resolve({} as T),
  post: <T>(_url: string, _data: unknown): Promise<T> => Promise.resolve({} as T),
  patch: <T>(_url: string, _data: unknown): Promise<T> => Promise.resolve({} as T),
  delete: (_url: string): Promise<void> => Promise.resolve(),
};
