# Payleor plugin

Payleor is the money flow and the trust around paid work. With this plugin your AI assistant finds offerings that freelancers, studios and AI sellers list on Payleor, sends a quote request with a brief you agreed on, helps you answer the team's questions, shows each freelancer's quote side by side, and follows the project to delivery. You accept quotes and deliveries and pay with the buttons in Payleor's cards; payment happens on the team's Payleor pay page with PayPal, so the assistant never pays or accepts for you.

Everything runs in the PayPal sandbox during the hackathon: pay with a PayPal sandbox buyer account.

## Contents

- **Connector:** `https://api.payleor.com/mcp`. The first time, you sign in with a Payleor account (email and password) and allow the connection.
- **Tools:** `search_offerings`, `request_quote`, `list_my_projects`, `get_project`, `reply`, `request_changes`, plus `accept_quote` and `accept_delivery`, which only the card's buttons can call.
- **Skill:** `hire-a-professional` tells the assistant when Payleor fits and how to walk through a hire, with a reference of statuses, conversations and payments.

## Get the zips

From the repository root: `pnpm plugin:zip`. It writes `dist/plugin/payleor-plugin.zip` (Claude) and `dist/plugin/payleor-plugin-chatgpt.zip` (ChatGPT). For the staging hosts: `pnpm plugin:zip --mcp-url https://api.staging.payleor.com/mcp`, which writes the `-staging` pair.

## Install in Claude

1. Sign up at `https://dash.payleor.com/signup` and verify your email (or sign in if you have an account).
2. In Claude, open **Customize → Plugins → Add**, choose **Upload plugin** and pick `payleor-plugin.zip`. (Or add this repository as a plugin marketplace.)
3. Open the plugin's **Connectors** tab and connect Payleor. A Payleor window opens: sign in, check that it says you go back to `claude.ai`, and press **Allow**.
4. Try: "Find me someone to design a logo for my bakery under $400."

A connector alone also works: **Settings → Connectors → Add custom connector** with the URL `https://api.payleor.com/mcp` and no OAuth fields. You then get the tools without the skill.

## Install in ChatGPT

1. Sign up at `https://dash.payleor.com/signup` and verify your email.
2. **Web, with the skill:** at chatgpt.com, open **Plugins → Upload new or existing plugin** (this needs a verified developer identity) and pick `payleor-plugin-chatgpt.zip`. Connect when asked: sign in to Payleor, check that it says you go back to `chatgpt.com`, and press **Allow**.
3. **Web, tools only:** chatgpt.com/plugins → **Add custom MCP server** with `https://api.payleor.com/mcp`, then **Create as a plugin**.
4. **Desktop app, from a personal marketplace:**
   1. Copy this folder to `~/.codex/plugins/payleor`.
   2. Create `~/.agents/plugins/marketplace.json`:

      ```json
      {
        "name": "personal",
        "plugins": [
          {
            "name": "payleor",
            "source": { "source": "local", "path": "./.codex/plugins/payleor" },
            "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
            "category": "Productivity",
            "interface": { "displayName": "Payleor" }
          }
        ]
      }
      ```

   3. Restart the desktop app, open the Plugins Directory, choose the personal source and install Payleor. Sign in with your Payleor account when it asks.
5. In a new chat, mention Payleor the first time (developer-mode apps run when selected): "@Payleor find me someone to design business cards."

## What to expect

- Search returns only offerings their sellers list for AI assistants.
- After a request, the team's freelancers may ask you questions; the assistant drafts answers and sends them only after you approve the wording. Until you accept a quote, emails, phone numbers and messaging links are hidden from both sides.
- The project card shows one slide per freelancer, each with their quote and an **Accept quote** button. **Pay with PayPal** opens the team's pay page in a new tab; press **Check payment** afterwards.
- If the team declines, the card shows their reason and offers to search again.
