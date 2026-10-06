// Served by the api worker (Task 8); apps/web/worker/index.ts forwards /api/* there.
export function productImageUrl(key: string): string {
  return `/api/catalog/images/${key}`;
}
