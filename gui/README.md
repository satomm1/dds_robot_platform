# DDS Robot GUI

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Desktop installers (Electron)

End users can install a **desktop build** without Node.js or the command line. Installers are produced by [electron-builder](https://www.electron.build/) (Windows NSIS, macOS DMG, Linux AppImage). CI runs the workflow [`.github/workflows/gui-electron.yml`](../.github/workflows/gui-electron.yml).

### For end users: download from GitHub

1. Go to `https://github.com/satomm1/dds_robot_platform/actions/`
2. Click the most recent successful workflow runs.
3. Under **Artifacts** on the run summary, download the ZIP for your OS:
   - **Windows:** `gui-installer-windows-latest` — unzip, run **`DDS Robot GUI Setup … .exe`**, then start **DDS Robot GUI** from the Start menu. If SmartScreen warns (unsigned installer), use **More info** → **Run anyway** if you trust the source.
   - **macOS:** `gui-installer-macos-latest` — unzip, open the **`.dmg`**, drag **DDS Robot GUI** to Applications. If blocked, **right‑click → Open** the first time, or allow it under **System Settings → Privacy & Security**.
   - **Linux:** `gui-installer-ubuntu-latest` — unzip the **`.AppImage`**, run `chmod +x` on it if needed, then execute it. Install **FUSE** / **libfuse2** for AppImage support if your distro requires it.
4. **Backend:** This package is only the UI. Start the Docker services and host DDS scripts so the GraphQL server is available (see root [README](../README.md#local-stack-docker--host-dds)). The app uses **`http://localhost:8000/graphql`** by default (see [`src/apolloClient.js`](src/apolloClient.js)) unless the maintainer built it with another URL.

**Local Stack:** The **Local Stack** panel (right sidebar) runs **Docker Compose** (`docker compose up -d` / `down`, pulling `ghcr.io/satomm1/matt_python` from GHCR) and **DDS** (`start_scripts.sh` / `stop_scripts.sh` on the host via WSL on Windows). Set the **dds_robot_platform** repo path in settings and configure `dds/dds_env.sh` (from `dds_env.sh.example`). Works in **Electron** and **`npm start`** (not a static browser-only build). On Windows, commands run via WSL.

**Maintainers:** See the root [`README.md`](../README.md) for the same end-user steps in the main project docs.

**Custom GraphQL URL:** Set `REACT_APP_GRAPHQL_HTTP_URL` when creating the production bundle, then build again (CRA bakes this into the JS at build time):

```bash
# Example (Unix shell); on Windows use set in cmd or $env:... in PowerShell
export REACT_APP_GRAPHQL_HTTP_URL=http://192.168.1.10:8000/graphql
npm run build
npm run dist
```

**Maintainer commands** (from this `gui` directory):

- `npm run dist` — deletes `electron-dist/`, production React build, then OS installer into `electron-dist/`
- `npm run dist:dir` — same, but unpackaged app folder only (faster smoke test)
- `npm run clean:electron-dist` — remove `electron-dist/` only (helps clear locks before packaging)
- `npm run electron` — opens Electron against existing `build/` (run `npm run build` first if missing)

Windows builds use `signAndEditExecutable: false` and `CSC_IDENTITY_AUTO_DISCOVERY=false` so packaging works without a code-signing certificate (SmartScreen may still warn). Enable proper signing later for public distribution.

**If `npm run dist` fails** with *cannot resolve … electron-builder-binaries … status code 503*: GitHub’s release CDN was temporarily unavailable while downloading tools (e.g. NSIS). **Retry** after a minute, or rely on the default **`ELECTRON_BUILDER_BINARIES_MIRROR`** baked into `npm run dist` / CI (npmmirror mirror of those binaries). To force the official GitHub URLs instead, clear the variable for that shell, e.g. PowerShell: `Remove-Item Env:ELECTRON_BUILDER_BINARIES_MIRROR` then run `npx electron-builder` manually after `npm run build`.

**If `npm run dist` fails on Windows** with *cannot access the file … app.asar* / *being used by another process*: something still has the old `electron-dist` open (often a previous run of **DDS Robot GUI**, an **Explorer** window inside that folder, or **Defender** indexing). Quit the app, close those windows, end stray `electron.exe` in Task Manager if needed, then run `npm run dist` again. The `dist` script starts by deleting `electron-dist/`; if deletion fails, run `npm run clean:electron-dist` alone to see the same hints.

macOS DMGs from CI are **unsigned**; users may need to right-click the app and choose Open the first time, or adjust Gatekeeper settings. Add Apple Developer ID signing and notarization for wider distribution.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.
