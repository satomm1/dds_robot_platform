# DDS Robot GUI

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Desktop installers (Electron)

End users can install a **desktop build** without Node.js or the command line. Installers are produced by [electron-builder](https://www.electron.build/) (Windows NSIS, macOS DMG, Linux AppImage). CI builds all three on push/PR under **GitHub Actions** (see [`../.github/workflows/gui-electron.yml`](../.github/workflows/gui-electron.yml)); download the artifact for your OS.

**Backend:** The packaged app only contains the UI. Start your GraphQL server separately. By default the UI calls `http://localhost:8000/graphql` (see [`src/apolloClient.js`](src/apolloClient.js)).

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

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
