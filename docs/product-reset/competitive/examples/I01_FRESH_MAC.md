# I01 — fresh Mac to first successful task

## User goal

> Install Bimax, open a sample project, fix its failing test, and then let Bimax verify one screen in
> the sample Mac app.

Run on the oldest supported macOS and current macOS, for every shipped architecture.

## Track separately

### Terminal only

- download/install;
- provider sign-in/key setup;
- open sample project;
- run C01;
- confirm no Accessibility or Screen Recording request appears.

### Desktop coding

- download/install/launch;
- select folder and provider;
- run C01 with zero Computer Use permissions;
- review the diff and receipt.

### Desktop Computer Use

- start X01's GUI verification stage;
- request Screen Recording/Accessibility only now;
- grant, revoke, and re-grant;
- show app/service/build identity and recovery instructions.

## Measurements

- clicks/commands before first useful prompt;
- time to first token and first successful task;
- permission prompts and restarts;
- Gatekeeper steps;
- user-visible errors/recovery choices;
- whether a terminal or YAML edit was unexpectedly required;
- update behavior with permissions already granted.

## Pass

- the declared distribution channel's gate passes;
- Terminal never requests CU permissions;
- Desktop can code without CU permissions;
- CU permissions are contextual and owned by Bimax.app;
- the staged binary/service hashes match the release manifest;
- update/rollback preserves projects and reports whether permissions need regranting;
- uninstall leaves user projects untouched.
