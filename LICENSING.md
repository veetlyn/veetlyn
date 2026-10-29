# Licensing

Veetlyn is open core. The repository holds three kinds of code under three licenses.

| Code | License |
|---|---|
| Everything outside `ee/` and `packages/oss/` | [AGPL-3.0-only](LICENSE), or a separate commercial agreement |
| `ee/` | [Veetlyn Enterprise License](ee/LICENSE): commercial; free to develop and test, a commercial agreement for production |
| `packages/oss/*` packages that declare MIT | MIT, as stated in each package |

## The AGPL core

The core is the full product: quotes, projects, PayPal payments, deliveries, team payouts by approval or rule, seller pages and the Network connector. AGPL recipients keep every right the AGPL grants: use, modification and redistribution, with its source-sharing obligations for modified network services. Companies that cannot meet those obligations can take the core under a commercial agreement instead.

## The ee/ folder

`ee/` holds the features sold on top of the core: custom offers, Network membership, the payout agent and multi-account. Its license allows copying, modifying and running the code to develop and test it; production use needs a commercial agreement. The core never imports from `ee/` and runs without it.

## Commercial agreements

Commercial agreements cover private deployments by default; joining **Veetlyn Network** is an optional add-on. An agreement names the licensor, the software and version, permitted deployments and users, fees, redistribution rights, support, termination and any Network add-on. This notice itself grants no commercial license. Contact: https://veetlyn.com/contact.

## Contributions, third parties and marks

Contributions are accepted only when their authors permit both licensing paths for the core and the Enterprise License for `ee/`. Third-party material keeps its own license. The Veetlyn name and logo are not licensed by any of these licenses.
