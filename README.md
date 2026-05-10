# WatchVault

Dark luxury watch collection vault — local-only state (no auth, no database).

## Run

```bash
npm install
npm run dev
```

## Key behaviors

- “Start your vault” scrolls to the add-watch form.
- “View collection” scrolls to the collection section.
- Header “Add Watch” scrolls to the add-watch form.
- Uploading a photo creates an immediate preview URL via `URL.createObjectURL(file)` and stores it in the watch object.
- Cards render the uploaded photo with a normal `img` tag; if no photo exists, a placeholder is shown.

