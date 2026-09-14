# PSX Research Helper

The helper polls the private Research Desk, downloads official reports into `companies/<TICKER>/`, extracts page-marked text, requests a cost-capped structured analysis, saves the local dossier files, and uploads the validated dossier to the app.

Open Research Desk, choose **Connect Mac helper**, create a one-time pairing token, then run `./research-helper/install.sh`. The token is stored only in `~/.psx-research-helper/config.json` with owner-only permissions. Revoke the helper from the app if the Mac or token is no longer trusted.
