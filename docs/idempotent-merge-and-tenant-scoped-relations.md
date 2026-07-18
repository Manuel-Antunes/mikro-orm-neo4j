# Appendix — Idempotent `MERGE` (C10) & tenant-scoped relations (C11)

> Applies to `mikro-orm-neo4j` ≥ 0.2.4 · `@mikro-orm/core` 7.x · Neo4j 5.x
>
> This appendix documents two correctness fixes in the driver's write path and
> the composite primary-key support that ships alongside them. Both were
> previously observable bugs; the tests that pin them live in
> [`tests/Neo4jMergeAndTenantRelations.test.ts`](../tests/Neo4jMergeAndTenantRelations.test.ts).

## Summary

| ID | What was wrong | Impact | Fix |
|----|----------------|--------|-----|
| **C10** | `nativeInsert` emitted `CREATE`, so re-persisting the same primary key created a **second node** | Duplicated nodes on every re-projection / idempotent write | `MERGE` on the primary key, `SET` the rest |
| **C11** | Relationships matched their endpoints by a hardcoded `id`, ignoring the rest of a composite key | **Cross-tenant leak**: an edge from tenant `A` also attached to tenant `B`'s node that shared the same business `id` | Match **every** primary-key column of both endpoints |
| **(enabler)** | Composite primary keys such as `(tenant, id)` were not honoured end-to-end — only the first column was ever written or matched | Composite-key entities silently unusable | Sweep `primaryKeys[0]` reads to compose the whole key |

C11 is a security fix: in a model where `tenant` is the isolation boundary, an
edge reaching another tenant's node is one tenant's data touching another.

---

## C10 — `nativeInsert` is now idempotent by primary key

**Before.** `nativeInsert` built a `CREATE (n:Label { ...allProps })`. A `CREATE`
always makes a new node, even when one with that primary key already exists, so
projecting the same entity twice left two nodes with the same `id`.

**After.** The primary key goes into a `MERGE` pattern; every other property is
applied afterwards with per-property `SET`:

```cypher
MERGE (n:Label { id: $id })      // composite PKs merge on all key columns
SET n.name = $name, n.price = $price
RETURN n
```

- `SET n.prop = $value` (not `SET n = { ... }`) keeps the merge key stable and
  never wipes properties the write omitted — the `+=` semantics.
- `nativeInsertMany` inherits this automatically; it just loops `nativeInsert`.

**Behavioural change to be aware of.** `nativeInsert` went from
"insert, always" to "insert-or-update by PK". Code that relied on a duplicate PK
raising a constraint violation at insert time will no longer see it from this
path (the normal `em.persist → flush` route is unaffected — the Unit of Work
still decides insert vs. update). Unique constraints on **non-PK** properties
are still enforced, because `MERGE` keys only on the PK and the conflicting
value is applied via `SET`.

---

## C11 — relationships match the **full** primary key

**Before.** Both endpoints of every relationship were matched on `id` alone:

```cypher
MATCH (a) MATCH (b:Label)
WHERE a.id = $source AND b.id = $target   -- ⚠️ id only
MERGE (a)-[r:REL]->(b)
```

Because `MATCH … MATCH … WHERE … MERGE` is cartesian, if two nodes shared the
same business `id` (two tenants, same PK) the edge fanned out to **both**.

**After.** A shared `pkPredicate` helper iterates `getPrimaryProps()` and
constrains **every** key column of both endpoints:

```cypher
MATCH (a) MATCH (b:Label)
WHERE a.id = $sId AND a.tenant = $sTenant
  AND b.id = $tId AND b.tenant = $tTenant
MERGE (a)-[r:REL]->(b)
```

The fix is applied at **both** relationship-creation sites — `persistRelations`
(used by `nativeInsert` / `nativeUpdate`) and `insertRelationshipEntity` (pivot
entities). Matching on the full key only isolates tenants **if `tenant` is part
of the primary key** — see below.

---

## Composite primary keys are now honoured end-to-end

Making C11 real requires `tenant` (or any scoping column) to be part of the
primary key:

```ts
@Entity()
class Document {
  @PrimaryKey({ type: 'string' })
  id!: string;

  @PrimaryKey({ type: 'string' })
  tenant!: string;   // composite PK: (id, tenant)

  @Property({ type: 'string' })
  title!: string;
}
```

The driver previously assumed a single-column PK in several places
(`getPrimaryProps()[0]`, `primaryKeys[0]`). Those reads were swept so that
node writes, relationship matching and endpoint navigation all compose the
**whole** key. Two helpers on `Neo4jCypherUtils` centralise this:

- `pkPredicate(node, meta, idValue)` — builds the `WHERE` matching a node by its
  complete PK.
- `extractPk(meta, props)` / `extractRelatedPk(meta, val)` — normalise a PK value
  (scalar for single-column PKs, `{ [pkName]: value }` for composite) out of a
  node's property bag or a serialized relationship endpoint.

> **Wire-format note.** MikroORM serializes a composite foreign key as a
> **positional array** ordered to match `getPrimaryProps()` — e.g.
> `["DOC-1", "acme"]` for `(id, tenant)`. `extractRelatedPk` accepts that array
> form as well as a scalar id or a key-object.

### Limitation

The denormalized foreign-key value stored *as a node property* (e.g. a
`document` property on a child node) stays scalar — Neo4j cannot store an object
as a property — and keeps the **first** key column for composite targets. This
does not affect relationship correctness: the graph edge itself carries the full
key match. Single-column PKs are unchanged.

---

## Test coverage

[`tests/Neo4jMergeAndTenantRelations.test.ts`](../tests/Neo4jMergeAndTenantRelations.test.ts)
pins the behaviour end-to-end against a real Neo4j (Testcontainers):

1. **C10 idempotency** — persisting the same PK twice yields **one** node, updated.
2. **C10 non-regression** — two distinct PKs yield two nodes.
3. **C10 property preservation** — a second write keeps properties it omits.
4. **C11 isolation** — two documents share an `id` across tenants `A`/`B`; a
   chunk in tenant `A` links **only** to `A`'s document.
5. **Composite-PK round-trip** — persist, reload and navigate a relation whose
   both endpoints have a composite key.

The full pre-existing suite (all single-PK) stays green, proving the composite
sweep did not regress the common case.
