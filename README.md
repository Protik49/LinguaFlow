LinguaFlow

Lightweight browser extension that shows inline translations and tooltips to help you read in another language.

LinguaFlow provides quick translations, pronunciation, and vocabulary saving while you browse. It integrates with OpenRouter (Gemma) or Google's Gemini for translation models and includes a small local vocabulary manager.

---

## Features

- Detects words on a page and shows translations as a tooltip or inline text
- Supports multiple target languages and difficulty levels
- Save vocabulary entries with translation, definition, pronunciation and context
- Export/import saved vocabulary (JSON / CSV)
- Caches translations locally for speed

---

## Quickstart (Dev)

1. Install dependencies

```bash
npm install
```

2. Run the dev server (Vite)

```bash
npm run dev
```

3. Load the extension in your browser (Chrome / Edge)

- Open `chrome://extensions` (or `edge://extensions`) and enable Developer mode
- Click "Load unpacked" and select the `dist` or `build` output folder once you run the build step

---

## Build & Package

Build a production bundle (adjust scripts in `package.json` if needed):

```bash
npm run build
```

After building, load the output folder as an unpacked extension in your browser to test the packaged extension.

---

## Project Structure

- `src/options` — Options UI (extension settings)
- `src/popup` — Popup UI shown when the extension icon is clicked
- `src/content` — Content scripts that scan the DOM and show translations
- `src/shared` — Shared types, storage helpers, API constants
- `src/background` — Background/service worker logic

See the `src` folder for implementation details.

---

## Configuration

API provider selection and keys are managed from the options page. Supported providers:

- `openrouter` (uses Gemma model via OpenRouter)
- `gemini` (Google Gemini via API key)

When using `openrouter`, get a key at https://openrouter.ai/keys. For `gemini` integration, follow the provider's API key instructions.

---

## Contributing

Contributions are welcome. Please open an issue or submit a PR with a clear description of the change. Suggested steps for new contributors:

1. Fork the repository
2. Create a feature branch
3. Run and verify the project locally
4. Submit a pull request with tests or a clear manual test plan

---

## Notes & Next Steps

- Add a `LICENSE` file if you want to specify a license (MIT is common for extensions)
- Add CI for linting, type checking and building
- Consider publishing the extension to the Chrome Web Store or Edge Add-ons when ready

---

## Maintainers

Maintained by the project authors. For questions or help, open an issue in this repository.
