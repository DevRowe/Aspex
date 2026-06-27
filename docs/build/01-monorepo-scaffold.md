# Card 01 — Monorepo scaffold

## Goal
Create the empty Bun-workspace monorepo skeleton so every later card has a place to put files and `bun install` / `bun test` / lint all work. **No app logic yet.**

## Depends on
Nothing. This is the first card.

## Prerequisites (install once)
- Bun ≥ 1.1 (`bun --version`). Install: https://bun.sh
- Git.

## Files to create
```
aspex/
  package.json
  tsconfig.base.json
  biome.json
  .gitignore
  README.md                      # one paragraph; full README is card 21
  apps/hub/package.json
  apps/hub/tsconfig.json
  apps/hub/src/index.ts          # prints "hub placeholder" and exits
  apps/web/.gitkeep              # scaffolded for real in card 11
  packages/schema/package.json
  packages/schema/tsconfig.json
  packages/schema/src/index.ts   # export {} (empty for now)
  examples/.gitkeep
```

## Exact contents

**`package.json`** (root):
```json
{
  "name": "aspex",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "typecheck": "bun run --filter '*' typecheck",
    "test": "bun test",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "typescript": "^5.5.0"
  }
}
```

**`tsconfig.base.json`**:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  }
}
```

**`biome.json`**: use Biome defaults with `"organizeImports": { "enabled": true }` and formatter enabled (2-space indent, double quotes).

**`apps/hub/package.json`**:
```json
{
  "name": "@aspex/hub",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "dev": "bun run src/index.ts"
  },
  "devDependencies": { "bun-types": "latest" }
}
```

**`apps/hub/tsconfig.json`**: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`. Same pattern for `packages/schema/tsconfig.json`.

**`apps/hub/src/index.ts`**:
```ts
console.log("hub placeholder");
```

**`packages/schema/package.json`**:
```json
{
  "name": "@aspex/schema",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

**`.gitignore`**: `node_modules`, `dist`, `*.sqlite`, `.aspex/`, `target/` (Tauri), `.DS_Store`.

## Steps
1. Create the folders and files above.
2. From repo root: `bun install`.
3. `bunx @biomejs/biome init` only if `biome.json` not already valid; then ensure the config above.
4. Run the acceptance check.

## Acceptance check
```bash
bun install                 # exits 0, creates bun.lockb
bun run apps/hub/src/index.ts   # prints: hub placeholder
bun run lint                # Biome reports no errors
```
All three succeed.

## Out of scope / do NOT do
- No real Hub, schema, web, or Tauri code — those are later cards.
- Do **not** add NATS, Socket.IO, Express, pnpm, or webpack (stack is locked — see index).
- Do not add dependencies beyond Biome + TypeScript + bun-types.
