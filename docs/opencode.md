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

Your installed OpenCode `1.18.x` uses the classic configuration keys `provider`, `npm`, and `options`. Use this format for that version. The newer v2 configuration uses different keys (`providers`, `package`, and `settings`) and will not be read correctly by OpenCode 1.x.

If your current file contains a top-level `providers` object, replace it with the configuration below. In OpenCode `1.18.25`, `providers`/`package`/`settings` is the v2 shape and will prevent this classic provider from being loaded.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "local-ai/active",
  "provider": {
    "local-ai": {
      "name": "Local AI Remote",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://SERVER:3000/v1",
        "apiKey": "{env:LOCAL_AI_BRIDGE_TOKEN}"
      },
      "models": {
        "active": {
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

Set the token only in the environment where OpenCode runs; never commit it. On Windows PowerShell:

```powershell
$env:LOCAL_AI_BRIDGE_TOKEN = "replace-with-the-same-token"
opencode
```

There are two separate token locations: `OPENCODE_BRIDGE_TOKEN` belongs in the Local AI Remote server `.env`, while `LOCAL_AI_BRIDGE_TOKEN` belongs in the environment of the computer running OpenCode and must contain the same value. The config reads the latter through `options.apiKey`; do not paste the token into the repository.
The client variable must contain only the token value, without the `Bearer ` prefix; the SDK adds that HTTP prefix automatically.

On macOS/Linux, use:

```bash
export LOCAL_AI_BRIDGE_TOKEN="replace-with-the-same-token"
opencode
```

Before opening OpenCode, verify the bridge from the same computer where OpenCode runs:

```powershell
curl.exe -i http://SERVER:3000/v1/models -H "Authorization: Bearer $env:LOCAL_AI_BRIDGE_TOKEN"
```

The response must be `HTTP/1.1 200` and include an `active` model. `401` means the token is missing or different from the server's `.env`; `403` means `OPENCODE_BRIDGE_ENABLED` is still false; `503` means the bridge token is not configured on the server; a timeout means the service is not reachable at that Tailscale/LAN address or port.

If you intentionally keep the old direct-provider setup (`100.106.130.118:11434/v1` or `:1234/v1`), it does not use the Local AI Remote bridge and therefore does not use `OPENCODE_BRIDGE_TOKEN`. To select models from the Local AI Remote UI, use the bridge URL on port `3000` and the `local-ai/active` model shown above.

To change the active local model, select a different model in Local AI Remote. OpenCode keeps using `local-ai/active`; no `config.json` edit is needed. You can also use a provider-prefixed model id when you need to pin a specific model. The bridge does not proxy tool calls yet; use it first for text/image-compatible local chat. Model capability metadata is still reported by `/v1/models`.

OpenCode documents custom OpenAI-compatible providers and the model capability/limit fields in its [provider documentation](https://opencode.ai/docs/providers) and [current model documentation](https://opencode.ai/v2/docs/models). Its [plugin API](https://opencode.ai/v2/docs/build/plugins) can reload a catalog after external model data changes, which is the next step if a fully automatic model catalog is needed.
