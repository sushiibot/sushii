# Code Style

## If blocks

Always use multi-line `if` blocks with braces — never single-line.

```ts
// ✓
if (condition) {
  statement;
}

// ✗ never
if (condition) statement;
```

Applies to all branches: `if`, `else if`, `else`.
