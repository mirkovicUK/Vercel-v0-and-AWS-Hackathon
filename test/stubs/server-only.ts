// Noop stub for the `server-only` package under Vitest.
// The real package throws when imported outside a React Server Component;
// server actions and db modules pull it in transitively, so tests stub it out.
export {}
