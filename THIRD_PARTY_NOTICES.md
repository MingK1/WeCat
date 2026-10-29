# Third-Party Notices

WeCat uses open-source packages distributed with the application. Their own license files are included with the installed dependencies.

## WeFlow CLI

- Project: <https://github.com/zhuobichen/weflow-cli>
- Package: `weflow-cli`
- License: MIT
- Role in WeCat: local WeChat 4.x database access, message export contract, and media matching.

WeCat invokes WeFlow CLI as a separate local process. WeCat owns its archive model, statistics, reports, and desktop experience. The WeFlow configuration and database credentials remain outside the renderer process.

WeCat optionally installs `pilk` into WeFlow's private Python environment to decode locally cached WeChat SILK voice messages into standard WAV files. No speech-recognition model is installed for this preservation path.

## Electron, React, ECharts, Lucide And Other Packages

Package names, exact versions, dependency relationships, and license files are available in `package-lock.json` and the installed `node_modules` tree.
