const storage: Record<string, unknown> = {};

const chromeMock = {
  runtime: {
    sendMessage: (...args: unknown[]) => {
      // Support callback-style: sendMessage(msg, callback)
      const cb = args.find((a) => typeof a === "function") as
        | ((...a: unknown[]) => void)
        | undefined;
      if (cb) cb();
      return Promise.resolve();
    },
    onMessage: { addListener: () => {} },
    id: "mock-extension-id",
  },
  storage: {
    local: {
      get: (keys: string | string[], callback?: (result: Record<string, unknown>) => void) => {
        const keyArr = typeof keys === "string" ? [keys] : keys;
        const result: Record<string, unknown> = {};
        for (const k of keyArr) if (k in storage) result[k] = storage[k];
        if (callback) {
          callback(result);
          return undefined;
        }
        return Promise.resolve(result);
      },
      set: (items: Record<string, unknown>, callback?: () => void) => {
        Object.assign(storage, items);
        if (callback) {
          callback();
          return undefined;
        }
        return Promise.resolve();
      },
      remove: (keys: string | string[], callback?: () => void) => {
        const keyArr = typeof keys === "string" ? [keys] : keys;
        for (const k of keyArr) delete storage[k];
        if (callback) {
          callback();
          return undefined;
        }
        return Promise.resolve();
      },
    },
  },
  sidePanel: {
    setPanelBehavior: () => Promise.resolve(),
    setOptions: () => Promise.resolve(),
    open: () => Promise.resolve(),
  },
};

Object.defineProperty(globalThis, "chrome", {
  value: chromeMock,
  writable: true,
});

// Reset storage between tests
beforeEach?.(() => {
  for (const key of Object.keys(storage)) delete storage[key];
});
