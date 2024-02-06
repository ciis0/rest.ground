# Insomnia

The main desktop application.

## Updating node-libcurl, electron

Adjust Electron version in `./.npmrc` to (the) one matching the/a [latest release](https://github.com/Kong/node-libcurl/releases), e.g. `28.0.0`.

```
# make sure ../.nprmrc is adjusted
npm install --save @getinsomnia/node-libcurl@latest
npm install --save-dev electron@28.0.0
```
