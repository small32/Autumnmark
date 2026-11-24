# Online theme catalog

Antumnmark+ reads `catalog.json` and its assets from the public `main` branch of
[`Autumn-one/autumnmark-theme`](https://github.com/Autumn-one/autumnmark-theme).
Commit the catalog and any new assets together. The app loads the catalog when the user opens
**Preferences → Theme → Online themes**.

## Catalog format

```json
{
  "version": 1,
  "themes": [
    {
      "id": "author/evening-paper",
      "revision": 1,
      "name": "Evening Paper",
      "author": "Author",
      "base": "nord",
      "path": "themes/evening-paper/1/theme.theme.json",
      "preview": "themes/evening-paper/1/preview.webp",
      "sha256": "<SHA-256 of the exact theme file bytes>",
      "minAppVersion": "0.24.0"
    }
  ]
}
```

- Use a stable lowercase ID and increment the positive integer `revision` on each update. Use a new ID when changing the built-in `base`.
- Use **Export theme** in the theme editor for the `.theme.json` asset. Its base must match the catalog entry. Compute the SHA-256 over the file as published.
- `preview` is optional. Use a relative PNG or WebP path for a Markdown sample showing headings, quotes, tables, and code. A built-in sample of the base theme is used if the preview is unavailable.
- `minAppVersion` is optional. It compares the three numeric version components of the desktop app, including preview builds.
- Paths are relative to the repository root. Publish each revision under its own path and retain its files so previously cached catalogs can still download that revision.

The catalog accepts up to 500 entries and 512 KiB. Each theme file can be up to
256 KiB, with the theme editor's existing CSS limits. Installed copies are
stored in the user's local theme library. Updating keeps their local ID and any
active theme selection.
