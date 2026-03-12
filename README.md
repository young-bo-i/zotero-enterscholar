# EnterScholar Translator for Zotero

A Zotero 7 plugin that provides LLM-powered text translation within the Zotero reader. Authenticate with [EnterScholar](https://enterscholar.com/) to get LLM configurations, or configure your own API keys locally.

## Features

- **Reader text selection translation**: Select text in PDF/EPUB reader and see the translation inline
- **Context menu translation**: Right-click annotations to translate
- **Discourse login**: Authenticate with the EnterScholar forum via the Discourse User API Key protocol
- **Dual config sources**: Use LLM config from the forum or your own local settings, with configurable priority
- **Multi-provider support**: OpenAI, Azure OpenAI, Anthropic, Google Gemini, DeepSeek, and any OpenAI-compatible API
- **Translation cache**: Frequently translated text is cached for instant results

## Requirements

- Zotero 7.x

## Installation (Development)

1. Build the plugin as an `.xpi` file (zip the project directory and rename to `.xpi`), or use a proxy file for development:

2. **Proxy file method** (recommended for development):
   - Find your Zotero profile directory
   - In the `extensions/` subdirectory, create a file named `enterscholar-translator@enterscholar.com`
   - Put the absolute path to this project directory as the file's only content
   - Restart Zotero

## Configuration

### Forum Authentication

1. Go to **Tools > EnterScholar Translator > Log In**
2. A browser window opens to the EnterScholar forum
3. Log in and authorize the application
4. The plugin receives an API key for accessing forum resources

### Local LLM Configuration

1. Go to **Zotero Preferences > EnterScholar Translator**
2. Set Configuration Source to "Local Only" or "Forum First"
3. Enter your API endpoint, key, and model name
4. Select the target language

### Discourse Admin Setup

For the forum integration to work, the Discourse admin needs to:

- Add the auth redirect URL to `allowed_user_api_auth_redirects`
- Ensure `allow_user_api_key_scopes` includes `read`

## Project Structure

```
manifest.json          - Zotero 7 WebExtension manifest
bootstrap.js           - Plugin lifecycle (startup, shutdown, event registration)
prefs.js               - Default preference values
content/
  auth.js              - Discourse User API Key authentication
  config.js            - LLM configuration management (forum + local)
  translate.js         - LLM translation engine (multi-provider)
  preferences.xhtml    - Settings panel UI
  preferences.js       - Settings panel logic
  preferences.css      - Settings panel styles
locale/
  en-US/enterscholar.ftl  - English strings
  zh-CN/enterscholar.ftl  - Chinese strings
```

## Building

```bash
cd zotero-enterscholar
zip -r enterscholar-translator.xpi manifest.json bootstrap.js prefs.js content/ locale/
```

## License

AGPL-3.0
