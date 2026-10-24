# Deno SQLite binding slots

Owner: [sqlite-parameters.ts](../runtimes/deno/src/sqlite-parameters.ts), used by
the optional [Deno provider](deno-sqlite.md). The public SqlStatement still uses
an ordered argument array. A pure adapter-local scan plans native named and
positional arguments before queue admission, with no SQL text rewriting.

Anonymous ? takes the next slot; ?NNN selects a numbered slot. Distinct prefixed
names (:name, @name, $name) allocate slots, while repeated identical names reuse
their first slot. Numbering follows the largest allocated slot, including holes.
The array length must equal the highest slot, up to 1000; unused holes still have
array positions. The scan skips strings, quoted identifiers and comments, and
recognizes Unicode names and SQLite's Tcl-style namespace/suffix tokens.
These forms follow [SQLite parameters](https://www.sqlite.org/lang_expr.html#parameters).

```ts
await database.execute({
  sql: 'SELECT ?2 AS second, ?1 AS first, :name AS third, :name AS repeated',
  args: [11, 22, 33],
})
// {second: 22n, first: 11n, third: 33n, repeated: 33n}
```

Deno's native driver accepts prefixed name properties and a separate positional
argument list. The plan retains the first native name attached to each slot and
keeps numbered question-mark slots on Deno's positional path. Bare-name lookup is
disabled. This handles mixed names, reordered indexes and aliases such as :name
followed by ?1 without swapping values or leaving omitted slots as NULL.

Original SQL is prepared/executed unchanged, preserving expression column names.
Native row objects cannot retain multiple columns with the same output name;
alias those columns explicitly. Invalid arity/slot/encoding rejects as input before
any statement effect. Native SQL syntax remains the driver's responsibility.
The separate [statement boundary](sqlite-statement-boundary.md) rejects trailing
statements and manual transaction controls. This scan is not an authorization
layer or an arbitrary SQL sandbox; applications choose their SQL and bind values.
See [native cases](../runtimes/deno/test/sqlite.test.mjs) and
[verification](deno-sqlite-testing.md).
