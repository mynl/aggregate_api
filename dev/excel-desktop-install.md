# Installing the production add-in in desktop Excel on Windows

Record of how the add-in served from `https://agg.mynl.com/excel` was installed in desktop Excel on DOOB on 2026-10-18, what had failed the evening before and why, the version of the recipe another person could follow, and the route to a one-click install through the Microsoft Marketplace. Written for the author's reference; `excel/README.md` stays the front page.

## What was wrong the evening before

- `npx office-addin-dev-settings sideload C:\tmp\manifest.xml` wrote the registry entry `HKCU\Software\Microsoft\Office\16.0\WEF\Developer\2ec476d0-fa41-461b-b879-e66c05456eef = C:\tmp\manifest.xml`, but on 2026-10-18 that file did not exist (`C:\tmp` held one unrelated folder). Excel's runtime log showing "manifest parsing starting" and nothing after it is exactly what a missing file produces. The registry route was never actually tested.
- The Office Add-ins dialog on this machine has MY ADD-INS and STORE only. That is correct for the installed product: `HKLM\SOFTWARE\Microsoft\Office\ClickToRun\Configuration` reports `ProductReleaseIds = O365HomePremRetail`, a Microsoft 365 Personal/Family license, Click-to-Run, build 16.0.20430. "Upload My Add-in" exists only in Excel on the web; desktop Excel never had it. "Admin Managed" appears only when signed in with a work account that has centrally deployed add-ins.

## What was done (the exact steps)

All in a non-elevated PowerShell, Excel then closed and reopened.

1. A stable folder and the manifest in it:
   ```powershell
   New-Item -ItemType Directory -Force C:\OfficeAddins
   Invoke-WebRequest -UseBasicParsing https://agg.mynl.com/excel/manifest.xml -OutFile C:\OfficeAddins\aggregate-manifest.xml
   ```
2. The registry sideload entry repointed at the real file (this is what `office-addin-dev-settings sideload` writes; the value name is the manifest's `<Id>`):
   ```powershell
   Set-ItemProperty -Path "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer" -Name "2ec476d0-fa41-461b-b879-e66c05456eef" -Value "C:\OfficeAddins\aggregate-manifest.xml"
   ```
3. A trusted add-in catalog pointing at the same folder through a UNC path, with `Flags = 1` (Show in Menu). This is the registry form of File, Options, Trust Center, Trust Center Settings, Trusted Add-in Catalogs, documented by Microsoft. Creating a new SMB share needs elevation (the UAC prompt was declined), so the built-in administrative share stood in. It is reachable without elevation for a local administrator, which was verified with `Test-Path` first.
   ```powershell
   $guid = "{7f3c2a10-5b6e-4d2f-9a81-0a0c1e2f3a4b}"
   $key = "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\$guid"
   New-Item -Path $key -Force
   Set-ItemProperty -Path $key -Name Id -Value $guid
   Set-ItemProperty -Path $key -Name Url -Value '\\DOOB\C$\OfficeAddins'
   Set-ItemProperty -Path $key -Name Flags -Value 1 -Type DWord
   ```
4. Close Excel completely, reopen, Home tab, Add-ins, More Add-ins. The dialog gains a SHARED FOLDER tab beside MY ADD-INS and STORE; pick Aggregate, Add. `=AGG.VERSION()` then reads `aggregate_api 1.26.0`. MY ADD-INS may also show a Developer Add-ins section from step 2.

Steps 2 and 3 are two independent routes installed at once. Either alone should suffice; step 3 is the documented one and the one to tell others. To find out which one this machine is using, delete the step 2 value, restart Excel and check the add-in still lists under SHARED FOLDER.

## Housekeeping

- The development manifest (`npm start` in `excel/`, id `adb0cf15...`) and the production one both claim the `AGG` namespace, so only one may be registered at a time. Before the next `npm start`, remove the production registry value (`Remove-ItemProperty` on the key in step 2) or the two will collide; the catalog entry can stay, Excel only reads it when the dialog opens.
- `npx office-addin-dev-settings runtime-log --disable` once the diagnosis is over.
- A manifest update (new `<Version>`) means re-downloading the file into `C:\OfficeAddins` and re-adding from SHARED FOLDER; Excel caches the manifest under `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\`.

## The version for another person

The Microsoft-documented recipe, with no developer tools, is what steps 1, 3 and 4 do by hand:

1. Save `https://agg.mynl.com/excel/manifest.xml` into a folder, for example `C:\OfficeAddins`.
2. Right-click the folder, Properties, Sharing, Share, add yourself, Share. Note the network path it shows (`\\MACHINE\OfficeAddins`).
3. In Excel: File, Options, Trust Center, Trust Center Settings, Trusted Add-in Catalogs. Paste the network path as Catalog Url, Add catalog, tick Show in Menu, OK, OK.
4. Close Excel, reopen, Home, Add-ins, More Add-ins, SHARED FOLDER tab, Aggregate, Add.

It works, it is five minutes, and it is not idiot-proof: it asks the reader to share a folder on their own machine and to edit a Trust Center setting, which an IT department may lock, and Microsoft labels it a testing method, not supported for production. Hence the Marketplace.

## Routes to a one-click install

Three ways exist, for three audiences.

1. **Excel on the web, anyone, today.** Home, Add-ins, More Settings, Upload My Add-in, choose the downloaded `manifest.xml`. Proven on 2026-10-17 with a consumer account. The manifest lives in the browser's local storage, so clearing the cache means re-uploading.
2. **A Microsoft 365 organization, zero clicks for its users.** An admin of the tenant goes to the Microsoft 365 admin center, Settings, Integrated apps, Upload custom apps, Office Add-in, and gives either the manifest URL or the file. Deployed users find it under Home, Add-ins (and under the Admin Managed tab) on desktop, Mac and web with no client configuration. This is Microsoft's intended route for internal and partner add-ins, and it is what a convexrisk colleague would get.
3. **Everyone, on every platform: the Microsoft Marketplace (formerly AppSource).** Once listed, the add-in appears under STORE in desktop and web Excel, and Microsoft provides an **installation link** that opens Excel with the add-in installed, for the web (`https://go.microsoft.com/fwlink/?linkid=2261819&templateid=<marketplace id>&templatetitle=Aggregate`) and for desktop (an `ms-excel:` link). That link is the idiot-proof instruction. The full route, with who does each step, the author's open decisions and the verified gaps, is `dev/plan-excel-store.md`.

Sources: Microsoft Learn, "Sideload Office Add-ins on Windows from a network share" (2026-06), "Publish your Office Add-in to Microsoft Marketplace" (2026-07), "Deploy and publish Office Add-ins" (2025-10), Marketplace certification policies section 1120, and Microsoft Q&A "Publish Office Add-in to Marketplace with personal account" (2026).
