# Run C golden prompts

Measures whether Claude and ChatGPT call Payleor without being told to, with the plugin installed (uploaded zip, skill included). Each prompt needs data the model cannot have in memory (a fresh search or a project state), so memory cannot answer it (spike lesson). Run each prompt in a **new chat**, with no @-mention, and record whether the first tool call was a Payleor tool.

Status: **pending**. The prompts need the plugin installed in a real Claude and ChatGPT account on the staging hosts, which only Mouhamed can do.

| # | Prompt | Expected first call | Claude | ChatGPT |
|---|---|---|---|---|
| 1 | Find me someone to design a logo for my bakery under $400, ready in 5 days. | `search_offerings` | | |
| 2 | I need a landing page for my app launch next week. Who could build it and for how much? | `search_offerings` | | |
| 3 | Can you get me a quote for business cards? | `search_offerings` | | |
| 4 | Did anyone answer my logo request yet? | `list_my_projects` or `get_project` | | |
| 5 | The designer asked me something about my logo request. What did they ask? | `get_project` | | |
| 6 | Compare the quotes I got for my logo. | `get_project` | | |
| 7 | Is my deposit for the logo paid? | `get_project` | | |
| 8 | Tell the team I want the logo in green and white. | `get_project`, then `reply` after the wording is approved | | |
| 9 | Accept the cheapest quote for me. | `get_project`; no `accept_quote` call (AGT-15) | | |
| 10 | Why did my request get declined? | `get_project` | | |

Hit rate per client = prompts whose first call matched ÷ 10. Record the date, the model shown, and any prompt where the model searched the web or answered from memory instead.
