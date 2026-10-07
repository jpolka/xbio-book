# Explorer's Guide to Biology: static book

This repository holds the book's content. A build script turns it into a static website you can host anywhere.

```
book.json                 chapter order, collections, scientist info, publishing rules
chapters/*.html           chapter text, exactly as the editor saves it
dictionary/entries.json   Bio-Dictionary: term, definition, illustration, other forms
src/reader.css, reader.js the reader's look and behaviour (popovers, videos, contents)
build.js                  the builder
.github/workflows/        builds and publishes automatically on GitHub
```

## What the build does

1. Removes editor-only markup (block tools, rights menus, editable flags).
2. Turns each linked term into a real link to its dictionary page, and adds the popup data for that chapter.
3. Generates one page per dictionary entry, with automatic "Appears in" links back to the chapters.
4. Downloads figures, illustrations and video thumbnails into `dist/media`, so the site doesn't depend on the old servers. If a download fails, it keeps the original address and warns you.
5. Replaces each video with a thumbnail that loads the player when clicked (and links to Vimeo/YouTube when JavaScript is off).
6. Turns Explorer's Questions into `<details>` elements, so answers open even without JavaScript.
7. Runs checks and writes `build-report.md`. If there are any errors, the build stops and nothing is published.

| Check | Result |
|---|---|
| Term linked to a dictionary entry that doesn't exist | error |
| Broken link, or a link to a missing section | error |
| Figure missing its image or alt text | error |
| Dictionary entry with no definition | error |
| Figure rights not "XBio original", "Permission cleared" or "Public domain / CC" | warning, or error in go-live mode |
| Dictionary entry with no illustration, question with no answer, leftover placeholder text | warning |

Rights checking is set by `"rules": { "rights": "warn" }` in `book.json`. Change it to `"block"` once the image audit for the published chapters is finished. You can also run a go-live build at any time with `--strict`.

## Run it on your computer

Needs Node.js 20 or newer.

```bash
npm install
npm run build          # writes dist/ and build-report.md
npm run serve          # preview at http://localhost:8080
npm run build:strict   # go-live check: stops if any figure lacks cleared rights
```

You can also open `dist/index.html` directly in a browser.

## Publish on GitHub Pages (one-time setup)

1. Create a GitHub repository and push this folder to it (the `.gitignore` already leaves out `dist/`, `node_modules/` and `.cache/`).
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main`. The **Build and publish book** workflow builds the site and publishes it at `https://<account>.github.io/<repo>/`. The build report appears on the workflow run's summary page.

After that:

- **Every push to `main` publishes.** Later, the editor's Publish button will do this push.
- **Pull requests build without publishing,** so you can read the report first.
- **Actions → Build and publish book → Run workflow → Go-live build** runs the strict rights check.
- **Rolling back** means reverting the commit; the previous version is republished automatically.

## Adding a chapter

1. Save the chapter body from the editor into `chapters/<slug>.html`.
2. In `book.json`, give that chapter a `slug` and a `file` (and optionally `scientist` and `published`).
3. Build. Any terms that point to missing dictionary entries are listed in the report.
