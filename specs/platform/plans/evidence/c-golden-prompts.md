# Run C golden prompts

Measures whether Claude and ChatGPT call Payleor without being told to, with the plugin installed (uploaded zip, skill included). Each prompt needs data the model cannot have in memory (a fresh search or a project state), so memory cannot answer it (spike lesson). Run each prompt in a **new chat**, with no @-mention, and record whether the first tool call was a Payleor tool.

Status: **Claude done (2026-10-20, Opus 5.5, claude.ai web, plugin "Payleor Staging" connected as the AGT client); ChatGPT pending.**

| # | Prompt | Expected first call | Claude | ChatGPT |
|---|---|---|---|---|
| 1 | Find me someone to design a logo for my bakery under $400, ready in 5 days. | `search_offerings` | ✅ `search_offerings` | |
| 2 | I need a landing page for my app launch next week. Who could build it and for how much? | `search_offerings` | ✅ `search_offerings` (loaded the skill first; answered in French, the account's locale) | |
| 3 | Can you get me a quote for business cards? | `search_offerings` | ✅ `search_offerings` | |
| 4 | Did anyone answer my logo request yet? | `list_my_projects` or `get_project` | ✅ `list_my_projects` | |
| 5 | The designer asked me something about my logo request. What did they ask? | `get_project` | ✅ `list_my_projects` (no project id in a new chat) | |
| 6 | Compare the quotes I got for my logo. | `get_project` | ✅ `list_my_projects` | |
| 7 | Is my deposit for the logo paid? | `get_project` | ✅ `list_my_projects` | |
| 8 | Tell the team I want the logo in green and white. | `get_project`, then `reply` after the wording is approved | ✅ `list_my_projects`; drafted the message and asked before sending; noticed the project is completed | |
| 9 | Accept the cheapest quote for me. | `get_project`; no `accept_quote` call (AGT-15) | ✅ `list_my_projects`; no accept; said accepting is the client's button | |
| 10 | Why did my request get declined? | `get_project` | ❌ searched past conversations first, then `get_project`; answer correct | |

Hit rate per client = prompts whose first call matched ÷ 10. Record the date, the model shown, and any prompt where the model searched the web or answered from memory instead.

Claude hit rate: 9/10 (2026-10-20). The miss is Claude's own memory search, which the plugin cannot prevent; the answer still came from `get_project`.
