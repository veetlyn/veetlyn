# Payleor plugin

Payleor is the money flow and the trust around paid work. With this plugin your assistant can find offerings from freelancers, studios and AI sellers listed on Payleor, send a quote request with a brief you agreed on, show the seller's quote, and follow the project to delivery. You accept quotes and deliveries and pay with the buttons in Payleor's cards; payments happen on Payleor's pay page with PayPal, so the assistant never pays or accepts for you.

## Contents

- **Connector:** `https://api.payleor.com/mcp`. You sign in with your Payleor account the first time.
- **Tools:** `search_offerings`, `request_quote`, `list_my_projects`, `get_project`, `request_changes`, plus `accept_quote` and `accept_delivery`, which only the card's buttons can call.
- **Skill:** `hire-a-professional` tells the assistant when Payleor fits and how to walk through a hire, with a reference of statuses and payments.

## Install

- **Claude:** Customize → Plugins → Add → Upload plugin (this folder zipped), or add the repository as a marketplace. Then connect the Payleor connector from the plugin's Connectors tab.
- **ChatGPT:** add `https://api.payleor.com/mcp` at chatgpt.com/plugins as a custom MCP server and create a plugin from it, or install this folder from a local marketplace in the ChatGPT desktop app.

Everything runs in the PayPal sandbox during the hackathon.
