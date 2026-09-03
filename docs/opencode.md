# OpenCode bridge

Escarlet Local AI UI can expose Ollama and LM Studio through one authenticated OpenAI-compatible endpoint. This is useful when OpenCode runs on another device or when the model should be selected from this UI instead of editing two provider configurations.

## 1. Enable the bridge

Copy the example environment file to `.env`, then set a long random token:

```env
OPENCODE_BRIDGE_ENABLED=true
OPENCODE_BRIDGE_TOKEN=replace-with-a-long-random-token
```

Restart the Escarlet Local AI UI service after changing `.env`. Do not expose this endpoint directly to the Internet; use Tailscale or a private LAN and keep the bearer token secret.

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
The bridge also exposes the stable model id `active`. Selecting a model in the Escarlet Local AI UI chat stores it server-side and changes which provider/model receives requests sent to `active`.

## 2. Configure OpenCode once

Your installed OpenCode `1.18.x` uses the classic configuration keys `provider`, `npm`, and `options`. Use this format for that version. The newer v2 configuration uses different keys (`providers`, `package`, and `settings`) and will not be read correctly by OpenCode 1.x.

If your current file contains a top-level `providers` object, replace it with the configuration below. In OpenCode `1.18.25`, `providers`/`package`/`settings` is the v2 shape and will prevent this classic provider from being loaded.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "local-ai/active",
  "tools": {
    "skill": false
  },
  "provider": {
    "local-ai": {
      "name": "Escarlet Local AI UI",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://SERVER:3000/v1",
        "apiKey": "{env:LOCAL_AI_BRIDGE_TOKEN}"
      },
      "models": {
        "active": {
          "tool_call": true,
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

`tools.skill: false` is intentional for this bridge profile. OpenCode otherwise discovers the compatibility skills under `~/.agents/skills` and `~/.claude/skills` and includes their catalog in every model request. On a workstation with 1,833 skills that made one system message about 680,000 characters long. Disabling the skill tool in the shared global config removes the skills catalog for both the CLI and OpenCode Desktop while leaving the normal coding tools enabled. In a measured OpenCode 1.18.27 request, the JSON request dropped from about 714 KB to 30 KB. If you need OpenCode skills for another provider, use a separate config selected with `OPENCODE_CONFIG` instead of removing this safeguard.

The equivalent process-only escape hatches are `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` and `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`, but they are not the primary fix here: an application launched from the macOS Dock does not normally inherit variables exported by an interactive shell.

Set the token only in the environment where OpenCode runs; never commit it. On Windows PowerShell:

```powershell
$env:LOCAL_AI_BRIDGE_TOKEN = "replace-with-the-same-token"
opencode
```

There are two separate token locations: `OPENCODE_BRIDGE_TOKEN` belongs in the Escarlet Local AI UI server `.env`, while `LOCAL_AI_BRIDGE_TOKEN` belongs in the environment of the computer running OpenCode and must contain the same value. The config reads the latter through `options.apiKey`; do not paste the token into the repository.
The client variable must contain only the token value, without the `Bearer ` prefix; the SDK adds that HTTP prefix automatically.

On macOS/Linux, use:

```bash
export LOCAL_AI_BRIDGE_TOKEN="replace-with-the-same-token"
opencode
```

### macOS Keychain launcher (CLI and Desktop)

Environment substitution is the only OpenCode configuration mechanism used here for the bearer token. The repository and `opencode.jsonc` never store the secret. To make that practical for both terminal and Desktop launches, store the existing server token once in macOS Keychain. Keeping `-w` last makes `security` prompt for the value instead of placing it in shell history or the process arguments:

```bash
security add-generic-password -U \
  -a "$USER" \
  -s escarlet-local-ai-bridge \
  -w
```

Then use the launcher. Copy `scripts/macos/opencode-escarlet` to `~/.local/bin/opencode-escarlet` if it is not already installed:

```bash
# CLI/TUI
~/.local/bin/opencode-escarlet

# Desktop (quit an already-running OpenCode first)
~/.local/bin/opencode-escarlet --desktop
```

The launcher reads the token from Keychain, exports it only to the new OpenCode process, and never prints it. Direct launches from the Dock still require `LOCAL_AI_BRIDGE_TOKEN` in the GUI launch environment, so use `--desktop` when you do not want to place the token in a file or in `launchctl setenv` command arguments.

Before opening OpenCode, verify the bridge from the same computer where OpenCode runs:

```powershell
curl.exe -i http://SERVER:3000/v1/models -H "Authorization: Bearer $env:LOCAL_AI_BRIDGE_TOKEN"
```

The response must be `HTTP/1.1 200` and include an `active` model. `401` means the token is missing or different from the server's `.env`; `403` means `OPENCODE_BRIDGE_ENABLED` is still false; `503` means the bridge token is not configured on the server; a timeout means the service is not reachable at that Tailscale/LAN address or port.

If you intentionally keep the old direct-provider setup (`100.106.130.118:11434/v1` or `:1234/v1`), it does not use the Escarlet Local AI UI bridge and therefore does not use `OPENCODE_BRIDGE_TOKEN`. To select models from the Escarlet Local AI UI, use the bridge URL on port `3000` and the `local-ai/active` model shown above.

To change the active local model, select a different model in Escarlet Local AI UI. OpenCode keeps using `local-ai/active`; no `config.json` edit is needed. You can also use a provider-prefixed model id when you need to pin a specific model.

The bridge forwards OpenAI-compatible function definitions, assistant `tool_calls`, and `tool` result messages to Ollama and LM Studio models that advertise the `tools` capability. `tool_choice: "none"` sends a normal chat request. `"auto"`, `"required"`, and named `tool_choice` objects all forward tools, because Ollama and LM Studio only implement an auto-style choice. Requests that include tools for a model without the advertised capability return a clear `400`.

Text remains bounded: each message or text part accepts at most 200,000 characters, the combined text and serialized tool-call arguments accept at most 512,000 characters, and Fastify retains its 12 MB body limit for image-bearing requests. The global `tools.skill: false` setting keeps normal OpenCode requests well below these limits rather than allowing unlimited prompt payloads.

OpenCode documents custom OpenAI-compatible providers and the model capability/limit fields in its [provider documentation](https://opencode.ai/docs/providers) and [current model documentation](https://opencode.ai/v2/docs/models). Its [plugin API](https://opencode.ai/v2/docs/build/plugins) can reload a catalog after external model data changes, which is the next step if a fully automatic model catalog is needed.
