# Contributing

Issues and pull requests are welcome.

## Set up

1. Clone the repo.
2. Start Claude Code with `claude --plugin-dir <path to the clone>`.
3. After an edit, run `/reload-plugins`.

## Check your change

Run both from the repo root before you open a pull request:

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Add a test in `tests/work.test.tsx` for each change in behavior.

## Style

- Two-space indent, no semicolons, single quotes.
- Short comments that say what and why.
- Card markup must not change with the clock alone.

## Sample images

The images in `docs/images/` come from the real card code. To render them again:

```bash
npx -y tsx@4.19.2 scripts/render-cards.ts
```
