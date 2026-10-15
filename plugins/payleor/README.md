# Payleor plugin

Payleor is the money flow and the trust around paid work. With this plugin your assistant can find offerings from freelancers, studios and AI sellers listed on Payleor, send a quote request with a brief you agreed on, show the seller's quote, and follow the project to delivery. You accept quotes and deliveries and pay with the buttons in Payleor's cards; payments happen on Payleor's pay page with PayPal, so the assistant never pays or accepts for you.

## Contents

- **Connector:** `https://api.payleor.com/mcp`. You sign in with your Payleor account the first time.
- **Tools:** `search_offerings`, `request_quote`, `list_my_projects`, `get_project`, `request_changes`, plus `accept_quote` and `accept_delivery`, which only the card's buttons can call.
- **Skill:** `hire-a-professional` tells the assistant when Payleor fits and how to walk through a hire, with a reference of statuses and payments.

## Install

- **Claude:** Customize → Plugins → Add → Upload plugin (this folder zipped), or add the repository as a marketplace. Then connect the Payleor connector from the plugin's Connectors tab.
- **ChatGPT on the web:** add `https://api.payleor.com/mcp` at chatgpt.com/plugins as a custom MCP server; "Create as a plugin" wraps the connector (tools only, no skill).
- **ChatGPT desktop app:** install this folder from a personal marketplace to get the tools and the skill:
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
  4. After changing the plugin, refresh the copy in `~/.codex/plugins/payleor` and restart the app again.

Everything runs in the PayPal sandbox during the hackathon.
