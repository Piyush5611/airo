import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

// Lets deep integration calls (Apify runs) know which organization and feature they bill for.
export function withUsage(context, work) {
  return store.run({ ...(store.getStore() || {}), ...context }, work);
}

export function usageContext() {
  return store.getStore() || {};
}
