# Plan: list the Excel add-in on the Microsoft Marketplace

**Status: decisions D1 to D6 ruled by the author on 2026-10-18 (see the rulings below). Claude's steps wait for the author's go. The author's [account] step is stuck: Partner Center will not validate the author's email (2026-10-18), and the store listing may not happen.** Tracked as `[Excel-Store]` in `dev/TODO.md`.

**What survives without the store.** Four steps pay off whether or not a listing ever exists, and they go ahead regardless:
- [server-ready]: a public service needs a restart policy.
- [store-pages]: help, privacy and terms for the whole service, since every client calls the same public server. It now covers the Google Sheets template too (`dev/plan-sheets-template.md`) and would serve a Google Workspace Marketplace listing later.
- [audit-retention].
- [tenant-deploy].

Everything from [listing-kit] on waits for [account].

## Goal

Anyone with Excel installs the AGG functions in one click, from the STORE tab of Excel's add-in dialog or from an installation link, on Windows, Mac and the web. Today the add-in served at `https://agg.mynl.com/excel` installs only by sideloading: Upload My Add-in in Excel on the web, or a shared folder plus a Trust Center edit on Windows desktop (`dev/excel-desktop-install.md` records both). Neither is something to hand a colleague.

## Who does what

Every step below carries an owner.

- **Claude** means work in this repository that Claude can do and commit without the author, once the plan is ruled.
- **Author** means it needs the author's identity, accounts, machines, money, or legal authority: Partner Center, the VPS, a Mac, the convexrisk tenant, and every legal statement made in the author's name.
- **Both** means Claude drafts or prepares and the author approves, runs, or submits.

## Current state, verified 2026-10-18

- The production manifest passes Microsoft's store validation (`office-addin-manifest validate -p`, the same service Partner Center runs). It reports the platforms reviewers will test on: Excel on Windows (Microsoft 365), Excel on the web, Excel on Mac (Microsoft 365) and Excel 2019 or later on Mac.
- Icons meet the listing rules: 32 by 32 and 64 by 64 PNG over HTTPS. A 512 by 512 logo exists in `web/public/`.
- Custom functions HTML, JavaScript and JSON are all served from `agg.mynl.com`, which policy 1120.5.2 requires. The add-in has a ribbon command (policy 1120.5.3) and loads Office.js from Microsoft's CDN (policy 1120.3).
- **Gap:** no custom function has a `helpUrl` in `functions.json`. Policy 1120.5.1 requires one on every function.
- **Gap:** no privacy policy, terms page or help page exists. Partner Center requires HTTPS links to all three, and the privacy policy must name the add-in and say how personal information is handled.
- **Gap:** `<ProviderName>` reads "Stephen J. Mildenhall"; it must match the Partner Center publisher name.
- **What the service records.** Every build writes an audit row with the client IP address and the program text, kept indefinitely (`audit.py`, database at `/home/steve/.aggregate/api/audit.db` on the VPS). The privacy policy must say so.
- **Caddy limits are live** on `agg.mynl.com`: 30 builds a minute per workbook session, 120 a minute and 1,200 an hour per address. `/docs` and `/v1/status` are closed to the public. Nothing owed there.
- **The VPS is ready (2026-10-20):** the service runs under a systemd unit, so it restarts on failure and on reboot, and `cache_max` is 100, as the hosting plan asked.

## Decisions for the author (D1 to D6)

Claude's recommendation comes first in each.

- **D1 Publisher.** Partner Center refuses personal Microsoft accounts; it needs a work account in a Microsoft Entra tenant. The convexrisk tenant already exists. Recommend publishing as Convex Risk under its legal business name. Whatever the name is, `<ProviderName>` becomes exactly that.
- **D2 Listing name.** It must match the manifest's `<DisplayName>`, at most 50 characters, and Microsoft asks for "function for brand" naming without the word Excel. Plain "Aggregate" will likely be taken or read as vague. Recommend **Aggregate Loss Distributions**. Alternatives: "Aggregate Distributions for Actuaries", "Aggregate by Convex Risk".
- **D3 Support channel.** The support URL must be a web page, not an email address. Recommend a help page on `agg.mynl.com` that points to GitHub issues and gives one contact email the author chooses.
- **D4 License terms.** Either Microsoft's Standard Contract (one checkbox, cannot be undone after publishing) or a link to our own terms. Recommend our own short terms page: free service, no warranty, fair use under rate limits, code under BSD-3. It stays editable.
- **D5 Audit retention.** Recommend pruning audit rows older than 90 days, and saying so in the privacy policy. The alternative is to disclose indefinite retention, which is legal to state and harder to defend. Pruning is the optional step [audit-retention].
- **D6 Mac.** Reviewers will test on Mac. Is there a Mac the author can use for an hour, desktop Excel and Safari? If not, submit anyway and treat the review as the Mac test.

**Rulings, 2026-10-18.** These are decisions, not proposals.

- **D1:** publish as Convex Risk, from the convexrisk tenant. `<ProviderName>` copies the legal business name exactly as entered and verified in Partner Center; the author supplies it once enrollment is done.
- **D2:** **Aggregate Loss Distributions**, as both the listing name and `<DisplayName>`.
- **D3:** the help page points to GitHub issues and to `help@convexrisk.com`.
- **D4:** our own short terms page, not Microsoft's Standard Contract.
- **D5:** prune audit rows older than 90 days; [audit-retention] is in scope.
- **D6:** a friend of the author's with a Mac runs the Mac checks from a step-by-step guide Claude wrote for a non-developer: `dev/store/mac-test-guide.md`. It covers saving the manifest with one Terminal line, Excel on the web in Safari (Upload My Add-in), Excel for Mac (the `wef` folder), the checks, what to send back, and removal. Run it once, after [store-pages] is deployed, so the help links are tested too.

## Steps

### [account] Partner Center enrollment. Owner: Author. Start now.

This has the longest lead time and blocks nothing else, so it runs in parallel with everything below. It is a sign-up form followed by verification checks that Microsoft runs on the business: email (the primary contact's business address receives a code), identity (a government ID whose name matches the account user), employment (domain documents for `convexrisk.com` from the registrar, showing business name, address and dates), and business (formation or registration documents matching the legal name and address exactly, no abbreviations). Microsoft quotes three to five business days; forum reports run to weeks when documents are requested. Publishing is blocked until every check reads Verified. Track it under Account settings, Legal info, Verification Summary.

1. Go to `https://partner.microsoft.com/dashboard/account/v3/enrollment/introduction/office` and sign in with the convexrisk work account (D1).
2. Fill in the publisher profile: legal business name, address, primary contact. Microsoft verifies these, which can take days and may ask for documents.
3. Accept the Microsoft Office Agreement, and the Microsoft AI Cloud Partner Program Agreement if prompted. No fee for a free add-in is listed in current documentation, but the flow may still ask for payment or tax details.
4. Confirm under Settings, Account settings, Programs that **Microsoft 365 and Copilot** shows as registered.
5. Under Marketplace offers, Microsoft 365 and Copilot, New offer, Office Add-in: enter the D2 name and **Check availability**. That reserves it. The publisher cannot be changed once the offer exists.

### [tenant-deploy] Interim install for colleagues. Owner: Author. Optional, any time.

A tenant admin uploads the manifest under the Microsoft 365 admin center, Settings, Integrated apps, Upload custom apps, Office Add-in, giving `https://agg.mynl.com/excel/manifest.xml`. Users in convexrisk then get the add-in with no setup on Windows, Mac and the web. It is also a free rehearsal of a "real" install before the store copy exists. Remove the DOOB sideload first (see [after-listing]); the two share an id and the `AGG` namespace.

### [server-ready] The public service can carry strangers. Owner: Author, on the VPS.

1. **Done 2026-10-20.** A systemd unit for the API (`human-hints.md`, "Run as a systemd service"), so the service restarts on failure and on reboot. A listed add-in that dies with the VPS is the likeliest one-star review.
2. **Done 2026-10-20.** `AGGAPI_CACHE_MAX=100` in the service environment, after checking free memory (entries run up to a few MB). Confirm with `curl http://10.8.0.1:19456/v1/meta`.
3. Nothing in Caddy. The limits are live, verified from the Caddyfile on 2026-10-18.

### [store-pages] Help, privacy and terms pages for the service, helpUrl, manifest identity. Owner: Claude. One version bump.

Needs D1 to D5 ruled. Runs whether or not the store listing happens (see Status).

**Revised 2026-10-18: one set of pages for the whole service, at the site root.** The pages were first planned inside the Excel bundle, at `/excel/help.html`. They now cover every client of the public server: the web app, the Excel add-in, and the Google Sheets template (`[Sheets-Template]`, `dev/plan-sheets-template.md`). So they live at the root, where a Google listing can link to them as naturally as Microsoft's. Whichever of this step and `[Sheets-Template]` lands second writes the Sheets lines.

1. **Three static pages** under `web/public/`, which Vite copies into the SPA bundle, served at `https://agg.mynl.com/help.html`, `privacy.html` and `terms.html` by the existing `/` mount. Plain HTML, one small stylesheet of their own, no scripts.
   - **`help.html`**: one section per function, with one anchor serving both spellings. The heading reads `AGG.BUILD` (Excel) / `AGG_BUILD` (Sheets) under `#agg-build`, and likewise for the rest. Then:
     - the `#AGG!` refusal convention and the rate limits;
     - how each client is installed (the Excel manifest; the Sheets copy link);
     - the support channel from D3.
   - **`privacy.html`**:
     - It names the service and its three clients.
     - It lists what is collected: IP address, program text, a per-workbook or per-spreadsheet session id, timestamps.
     - It says why: abuse prevention and usage statistics.
     - It gives the retention (D5), says nothing is sold or shared, and says there are no accounts and no cookies in either add-in.
     - It gives a contact.
     - Two Sheets specifics: its requests reach the server from Google's machines, so the audit records a Google IP address rather than the user's; and its session id is a hash of the spreadsheet id, never the id itself.
   - **`terms.html`**: the D4 terms, for the service as a whole.
2. **`@helpurl` on every custom function** in `excel/src/functions/functions.ts`, written against the development origin (`https://localhost:3000/help.html#agg-build`). `excel/webpack.config.js` already rewrites that origin to the production base in the manifest. Extend the rewrite to `functions.json` in production builds, mapping the development origin to the **origin** of the production base (`https://agg.mynl.com`), not to the base itself (`.../excel`), since the pages sit at the root. A development build's help links then go nowhere, which is harmless. If post-processing the metadata plugin's output proves awkward, write the production URLs directly and say why in a comment. YELL rather than build anything clever.
3. **Manifest** (`excel/manifest.xml`, from which the production one is derived):
   - `<DisplayName>` from D2.
   - `<Description>` matching the listing summary.
   - `<SupportUrl>` and the GetStarted LearnMoreUrl pointing at `/help.html`.
   - `<ProviderName>` from D1 only once [account] yields the verified legal name. Until then it stays "Stephen J. Mildenhall".
4. **Task pane footer** with links to Help, Privacy and Terms, as same-origin `/help.html` and so on. Microsoft asks for support inside the add-in, so users do not go to store reviews for help.
5. **Accessibility pass** on the task pane against Microsoft's add-in guidance: every input labeled, keyboard order sensible, contrast in light and dark Office themes.
6. **Guard test** in `excel/test/`: every `@customfunction` block in `functions.ts` has a `@helpurl` whose anchor exists in `web/public/help.html`. A new function without help then fails `npm test`, not the store review.
7. **`npm run validate:store`** in `excel/package.json`, running `office-addin-manifest validate -p` on the built production manifest. It sends the manifest to a Microsoft service, but the manifest is already public.
8. **Gates:** `npm test`, `npm run typecheck`, `npm run lint` and `npm run validate:store` in `excel/`; `uv run --no-sync pytest` at the root. After the commit, rebuild with both `.\scripts\build-web.ps1` (the pages) and `.\scripts\build-excel.ps1` (the manifest and `functions.json`).

The author then deploys with `refresh.sh` and opens the three pages on `agg.mynl.com` to check they read right. **Owner: Author.**

### [audit-retention] Prune old audit rows. Owner: Claude. One version bump. Only if D5 says prune.

A setting `AGGAPI_AUDIT_RETENTION_DAYS` (default 90, `0` keeps everything) and a delete of older rows, run at startup and at most once a day thereafter from the audit writer. A test with a scratch database (`AGGAPI_AUDIT_DB` pointed at scratch, per the standing rule). The status page's counts then cover the retention window, and its labels say so.

### [platform-pass] Test where the reviewers will. Owner: Author, with Claude for Chrome.

After [store-pages] is deployed, run this list on each platform below. Remove the DOOB sideload first if testing the tenant or store copy.

- Platforms: Windows desktop Excel; Excel on the web in Edge, Chrome and Firefox; on a Mac (D6), desktop Excel and Excel on the web in Safari, by the author's friend following `dev/store/mac-test-guide.md`.
- The list: the Aggregate button opens the pane; `=AGG.VERSION()`; `=AGG.BUILD("agg Dice dfreq [1] dsev [1:6]")` returns a handle; `=AGG.EXHIBITS`, `=AGG.EXHIBIT(handle,"summary")` and `=AGG.Q(handle,0.5)` spill or answer; `=AGG.LIBRARY()` and `=AGG.PROGRAM("DiceOneDie")`; `=AGG.FRAMES` and `=AGG.FRAMEURL`; a bad program reads as `#AGG!` text, not `#VALUE!`; the help link from the function wizard (fx) lands on the right anchor.
- Claude can drive Excel on the web in Chrome through the browser extension if the author is signed in and asks. Results go in this plan's execution log.

### [listing-kit] Everything the Partner Center forms ask for. Owner: Claude drafts, Author approves. No bump.

Written under `dev/store/`, so the forms become copy and paste.

1. `listing.md`: name (D2); summary of at most 100 characters; a description of 300 to 500 words in simple HTML that says plainly the add-in calls the free public service at `agg.mynl.com`, needs no account, and is rate limited (the service disclosure reviewers check for); up to three category suggestions and up to two industries (insurance, financial services); search keywords.
2. `certification-notes.md`: the reviewer's script. No sign-in exists, so it is short: install, open the pane, type three formulas into a blank workbook, and what each should show. Microsoft requires at least one custom function in these notes. Reviewers cannot contact us, so nothing may depend on asking.
3. `screenshots.md`: a shot list of three to five images (the pane beside a built handle, an exhibit spilled, quantiles, the library), with no personal information on screen. The author captures them (**Author**, or Claude in Chrome on request), sized as the form asks.
4. The listing logo, resized from `web/public/aggregate-api-logo-512.png` to whatever the form asks, after checking it is the same artwork as the manifest icons. Microsoft wants the store logo and the in-Office icon to match.

### [submit] Fill in and submit the offer. Owner: Author.

In Partner Center, on the offer reserved in [account]:

1. **Product setup:** Apple store no; Entra ID or SSO no; additional purchases no; CRM no.
2. **Packages:** upload the production manifest, saved from `https://agg.mynl.com/excel/manifest.xml`. Status must read Complete.
3. **Properties:** categories and industries from the kit; EULA link to `https://agg.mynl.com/terms.html` (D4); privacy link to `https://agg.mynl.com/privacy.html`; support link to `https://agg.mynl.com/help.html`.
4. **Marketplace listings:** English (United States) only, filled from `listing.md`, logo and screenshots.
5. **Availability:** as soon as approved. The schedule cannot be changed after the first publish.
6. **Review and publish:** paste `certification-notes.md` into Notes for certification, then submit.

Microsoft quotes three to four business days per response and four to six weeks overall, with several rounds being normal for a first submission. The report arrives by email and in Partner Center's Action Center.

### [review-loop] Fix and resubmit. Owner: Both.

The author forwards each rejection report. Claude fixes what lives in the repository (a bump if behavior changes), the author fixes what lives in Partner Center, and the author resubmits. Each round and its findings go in this plan's execution log.

### [after-listing] Point people at the store. Owner: Both.

1. **Author:** before installing the store copy on DOOB, remove the production registry value under `HKCU\Software\Microsoft\Office\16.0\WEF\Developer` and the trusted catalog key added on 2026-10-18 (both in `dev/excel-desktop-install.md`). Same add-in id, same `AGG` namespace.
2. **Claude:** `excel/README.md` and the top-level `README.md` lead with the store install and the installation links, built from the Marketplace asset id (`WA` followed by digits) Partner Center assigns. For the web: `https://go.microsoft.com/fwlink/?linkid=2261819&templateid=<asset id>&templatetitle=<url-encoded name>`. For Windows and Mac desktop: `ms-excel:https://api.addins.store.office.com/addinstemplate/en-US/<fresh GUID>/<asset id>/none/<url-encoded name>.xlsx?omexsrctype=1&isexternallink=1`. The sideload recipes move to a "for development" section. Documentation only, no bump.
3. **How updates reach store users,** to record once observed. The add-in's code and metadata (`functions.js`, `functions.json`, the pane) are served live from `agg.mynl.com`, so a deploy reaches everyone without resubmitting. A change to the manifest itself (name, URLs, ribbon, permissions, requirement sets) needs a resubmission and a review. Not yet known: whether Excel registers a **new** function from `functions.json` on a store install without a manifest change. Check it at the first bump that adds one (`[Excel-Info]`'s `AGG.INFO` is the natural test) and record the answer here.

## Order of work

```
[account] ─────────────── (days; author, start now) ───────────────┐
[server-ready] (author, any time before submit) ───────────────────┤
D1..D6 ruled → [store-pages] → deploy → [platform-pass] ───────────┼→ [submit] → [review-loop] → [after-listing]
                 [audit-retention] (if D5) ─┘   [listing-kit] ─────┘
[tenant-deploy] optional, any time after [store-pages] is deployed
```

If [account] never completes, the plan stops at [store-pages], [audit-retention], [server-ready] and [tenant-deploy], and `[Excel-Store]` closes there with the listing steps recorded as not taken.

## Acceptance

- The offer is live on the Microsoft Marketplace under the D2 name.
- On a Windows machine that never sideloaded it, Home, Add-ins, STORE finds the add-in by name, installs it, and `=AGG.VERSION()` answers with the server's version.
- The web installation link opens Excel on the web with the add-in installed.
- `help.html`, `privacy.html` and `terms.html` serve from the root of `agg.mynl.com`, cover the web app, the Excel add-in and the Sheets template, and every function's help link in the fx wizard lands on its own section.
- `npm run validate:store` passes, and the guard test fails if a function lacks help.

## Risks

- **Mac, unseen.** If D6 has no Mac, the review is the first Mac run. The pane and functions use nothing Mac-specific, so the risk is layout rather than function.
- **Rejection on wording** of the description or the service disclosure. Cheap to fix, but each round costs days.
- **A shared free server behind a public listing.** Rate limits and the log2 cap bound the cost; the systemd unit in [server-ready] bounds the downtime. A deploy that breaks the add-in now breaks it for every installed user, so `refresh.sh`'s manifest check stays part of every deploy.
- **The Excel 2019 for Mac target** the validator lists may lack the shared runtime in practice. If reviewers fail it there, raising the manifest's requirement sets narrows the platforms instead of changing code.

## Out of scope

- AppSource monetization, Publisher Attestation and Microsoft 365 Certification. All optional for a free add-in and possible after listing.
- The unified JSON manifest. The XML manifest is current and supported; converting buys nothing here.
- iPad and mobile. Custom functions do not run there.

## Sources

Microsoft Learn: "Publish your Office Add-in to Microsoft Marketplace" (2026-07), "Microsoft Marketplace step-by-step submission guide" (2026-10), "Microsoft 365 app publishing checklist", "Open an Office account in Partner Center" (2026-04), "Create effective listings", "Marketplace certification policies" section 1120, "Deploy and publish Office Add-ins". Microsoft Q&A, "Publish Office Add-in to Marketplace with personal account" (2026). Microsoft 365 Developer blog, "Top 5 AppSource validation errors for Office Add-ins submissions".

## Execution log

- **2026-10-18 [account]:** blocked. Partner Center will not validate the author's email, cause unknown. The listing may not happen; the steps listed under Status go ahead regardless.
- **2026-10-18 plan revised:** [store-pages] moves the three pages from `/excel/` to the site root (`web/public/`) and words them for the whole service, so the Google Sheets template and a possible Google Workspace Marketplace listing use the same pages.
