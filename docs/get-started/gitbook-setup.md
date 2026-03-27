# GitBook Setup

This docs tree is structured so it can be imported into GitBook with minimal reshaping.

## Recommended approach

Use GitBook with Git Sync and point it at this repository.

Suggested docs root:

- `docs/`

Suggested navigation entry:

- `docs/SUMMARY.md`

This repository now includes a root-level [`.gitbook.yaml`](../../.gitbook.yaml) so GitBook can detect the docs root and navigation automatically:

```yaml
root: ./docs/

structure:
  readme: README.md
  summary: SUMMARY.md
```

## Import strategy

1. create a GitBook space
2. connect the repository with Git Sync
3. let GitBook read `.gitbook.yaml`
4. import the `docs/` folder as the main product docs surface
5. keep the root markdown files as secondary references during migration
6. once the GitBook space is stable, decide whether root docs should stay as mirrors or become redirects

## If GitBook still shows the repo root

GitBook defaults to the repository root unless the docs root is configured.

If the space still opens from the wrong folder:

1. resync the repository
2. confirm GitBook can see the root `.gitbook.yaml`
3. reopen the space after the next sync

## Recommended information architecture

- `Get Started`
- `Concepts`
- `Build`
- `Architecture`
- `Reference`

That matches the structure already created in this repository.

## What should remain outside GitBook

Usually keep these out of the main docs sidebar:

- raw scenario JSON files
- audit logs
- local-only operator scratch files

Instead, document them from the `Reference` pages.

## Next step

If you want, the next pass can convert the root markdowns into:

- shorter landing pages
- canonical GitBook pages under `docs/`
- or redirect-style stubs that point readers into the docs tree
