// Categories are the catalog's departments: one shared tree for services and premade items. `parentId` is null
// for a top-level category. These helpers keep hierarchy handling in one place for selects, filters and pages.
export type CatalogCategory = { id: string; name: string; parentId: string | null };

export type FlatCategory<T extends CatalogCategory> = T & { depth: number; path: string };

export function flattenCategories<T extends CatalogCategory>(categories: readonly T[]): FlatCategory<T>[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const children = new Map<string, T[]>();
  for (const category of categories) {
    if (category.parentId && byId.has(category.parentId)) {
      children.set(category.parentId, [...(children.get(category.parentId) ?? []), category]);
    }
  }

  const flat: FlatCategory<T>[] = [];
  const visited = new Set<string>();
  const visit = (category: T, depth: number, parentPath: string | null, ancestry: ReadonlySet<string>) => {
    if (visited.has(category.id) || ancestry.has(category.id)) return;
    visited.add(category.id);
    const path = parentPath ? `${parentPath} / ${category.name}` : category.name;
    flat.push({ ...category, depth, path });
    const nextAncestry = new Set(ancestry).add(category.id);
    for (const child of children.get(category.id) ?? []) visit(child, depth + 1, path, nextAncestry);
  };

  for (const category of categories) {
    if (!category.parentId || !byId.has(category.parentId)) visit(category, 0, null, new Set());
  }
  // A parent cycle has no root; show its members once rather than dropping the branch.
  for (const category of categories) visit(category, 0, null, new Set());
  return flat;
}

export function categoryDescendantIds(categories: readonly CatalogCategory[], categoryId: string): Set<string> {
  const children = new Map<string, string[]>();
  const known = new Set(categories.map((category) => category.id));
  for (const category of categories) {
    if (category.parentId && known.has(category.parentId)) {
      children.set(category.parentId, [...(children.get(category.parentId) ?? []), category.id]);
    }
  }
  const ids = new Set<string>();
  const stack = [categoryId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return ids;
}
