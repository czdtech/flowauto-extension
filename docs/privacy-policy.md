# FlowAuto Extension Privacy Policy

Last updated: 2026-03-20

## Data Collection

FlowAuto Extension collects and stores the following data locally on your device:

- **Task queue data**: Prompts, generation settings, and task status
- **User settings**: Model preferences, timing settings, feature toggles
- **Reference images**: Temporarily stored in IndexedDB for generation
- **License key**: Stored locally for feature activation
- **API keys**: Optional OpenAI/Gemini keys stored locally for AI features
- **Notification credentials**: Optional Telegram/Discord tokens stored locally

## Data Storage

All data is stored locally in your browser using:
- `chrome.storage.local` for settings and queue state
- IndexedDB for image blobs

**No data is sent to our servers** except:
- License key validation (sent to LemonSqueezy API for activation/validation)
- AI proxy requests (Pro+ only, sent to our Cloudflare Worker which forwards to OpenAI)
- Notification delivery (sent to Telegram/Discord APIs when configured by user)

## Third-Party Services

- **LemonSqueezy**: License key validation only
- **OpenAI API**: When user configures own API key, or via Pro+ proxy
- **Google Gemini API**: When user configures own API key
- **Telegram Bot API**: When user configures notifications
- **Discord Webhooks**: When user configures notifications

## Data Sharing

We do not sell, share, or transfer your data to third parties.

## Contact

For privacy concerns, contact: [your-email@example.com]
