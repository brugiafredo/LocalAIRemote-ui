# OpenCode bridge

Local AI Remote can expose Ollama and LM Studio through one authenticated OpenAI-compatible endpoint. This is useful when OpenCode runs on another device or when the model should be selected from this UI instead of editing two provider configurations.

## 1. Enable the bridge

Copy the example environment file to `.env`, then set a long random token:

```env
OPENCODE_BRIDGE_ENABLED=true
OPENCODE_BRIDGE_TOKEN=replace-with-a-long-random-token
```

Restart the Local AI service after changing `.env`. Do not expose this endpoint directly to the Internet; use Tailscale or a private LAN and keep the bearer token secret.

The bridge exposes:

```text
GET  http://SERVER:3000/v1/models
POST http://SERVER:3000/v1/chat/completions
```

Every discovered model id is prefixed with its provider, for example:

```text
ollama/qwen3:8b
lmstudio/google/gemma-4
```

The provider prefix is required and the rest of the id is passed unchanged, so LM Studio model keys containing `/` continue to work.
The bridge also exposes the stable model id `active`. Selecting a model in the Local AI Remote chat stores it server-side and changes which provider/model receives requests sent to `active`.

## 2. Configure OpenCode once

OpenCode's current v2 configuration uses an OpenAI-compatible provider package and requires at least one model entry. Create an `opencode.jsonc` similar to this one and replace the example model with an id returned by `/v1/models`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "local-ai/active",
  "providers": {
    "local-ai": {
      "name": "Local AI Remote",
      "package": "@opencode-ai/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://SERVER:3000/v1",
        "apiKey": "{env:LOCAL_AI_BRIDGE_TOKEN}"
      },
      "models": {
        "active": {
          "modelID": "active",
          "capabilities": {
            "input": ["text"],
            "output": ["text"]
          },
          "limit": {
            "context": 32768,
            "output": 8192
          }
        }
      }
    }
  }
}
```

Set the token only in the environment where OpenCode runs; never commit it:

```powershell
$env:LOCAL_AI_BRIDGE_TOKEN = "replace-with-the-same-token"
opencode
```

To change the active local model, select a different model in Local AI Remote. OpenCode keeps using `local-ai/active`; no `config.json` edit is needed. You can also use a provider-prefixed model id when you need to pin a specific model. The bridge does not proxy tool calls yet; use it first for text/image-compatible local chat. Model capability metadata is still reported by `/v1/models`.

OpenCode documents custom OpenAI-compatible providers and the model capability/limit fields in its [provider documentation](https://opencode.ai/docs/providers) and [current model documentation](https://opencode.ai/v2/docs/models). Its [plugin API](https://opencode.ai/v2/docs/build/plugins) can reload a catalog after external model data changes, which is the next step if a fully automatic model catalog is needed.
