# Let-S APK Builder — Frontend

Static site served from GitHub Pages.

## Setup

1. Push this folder to a repo (e.g. `lets-apk-builder-frontend`).
2. Enable **Pages** → deploy from `main` branch, root folder.
3. Open `assets/app.js` and set `API_BASE` to your Render backend URL:
   ```js
   const API_BASE = "https://lets-apk-builder.onrender.com";
