# Testing the Aggregate add-in for Excel on a Mac

Thank you for helping. This takes about 30 minutes. You will try a free Excel add-in that builds insurance loss distributions, once in Excel on the web (in Safari) and once in Excel on your Mac if you have it. Nothing is installed outside Excel, and the last section removes everything.

**What you need**

- A Mac with Safari.
- A Microsoft account (any Outlook.com, Hotmail or work account) to open Excel on the web.
- Excel for Mac, if you have it. If you don't, do Part A only.

**What the add-in sends.** Only the formulas below. Each one sends the text inside its quotes to `agg.mynl.com`, which computes the answer. Nothing else in the workbook leaves your Mac.

## Step 1: Save the add-in file (once)

1. Press Command and Space together, type `Terminal`, press Return. A window with a text prompt opens.
2. Copy this line, paste it into Terminal, press Return:

```
curl -o ~/Downloads/aggregate-manifest.xml https://agg.mynl.com/excel/manifest.xml
```

A small file called `aggregate-manifest.xml` is now in your Downloads folder. Leave Terminal open.

## Part A: Excel on the web, in Safari

1. In Safari, go to `https://www.office.com`, sign in, choose Excel, and open a **Blank workbook**.
2. On the **Home** tab, click **Add-ins** (near the right end of the ribbon), then **More Add-ins** or **More Settings** (the label varies).
3. In the window that opens, click **Upload My Add-in**, then **Browse**, pick `aggregate-manifest.xml` from Downloads, and click **Upload**.
4. An **Aggregate** button appears on the Home tab. Go to "The checks" below.

## Part B: Excel for Mac

1. Quit Excel completely (Excel menu, Quit Excel).
2. Copy this line into Terminal and press Return. It puts the file where Excel looks for add-ins:

```
mkdir -p ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef && cp ~/Downloads/aggregate-manifest.xml ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/
```

3. Open Excel and a blank workbook. On the **Home** tab click **Add-ins** and choose **Aggregate** from the list. (On some versions it is **Insert**, then the small arrow beside **My Add-ins**, under **Developer Add-ins**.)
4. An **Aggregate** button appears on the Home tab. Go to "The checks" below.

## The checks (do them in Part A, then again in Part B)

Type each formula into the cell shown, exactly as written, and press Return. Write down OK, or what you saw instead.

| Cell | Type this | You should see |
|---|---|---|
| A1 | `=AGG.VERSION()` | text starting `aggregate_api 1.` |
| A2 | `=AGG.BUILD("agg Dice dfreq [1] dsev [1:6]")` | a label like `agg.Dice#` followed by letters and digits |
| A3 | `=AGG.Q(A2, 1)` | `6` |
| C1 | `=AGG.EXHIBIT(A2, "summary")` | a table that fills cells to the right and below |
| A5 | `=AGG.BUILD("this is not a program")` | text starting `#AGG!` and a reason (not `#VALUE!`) |
| A6 | `=AGG.LIBRARY()` | a long two-column list |

Then:

1. Click the **Aggregate** button on the Home tab. A side panel should open describing the functions. Close it.
2. Click cell A2, then the **fx** button left of the formula bar. If the window shows a link to help for this function, click it; a help page should open at the BUILD section. (If there is no such link, just note that.)

## What to send back

- The table above with OK or what you saw, for Part A and for Part B.
- A screenshot of anything that looked wrong: press Shift, Command and 4 together, then drag over the area; the picture lands on your desktop.
- Your Excel version (Excel menu, About Excel) and macOS version (Apple menu, About This Mac).

## Remove it afterwards

- **Part B:** quit Excel, paste this into Terminal and press Return:

```
rm ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/aggregate-manifest.xml
```

- **Part A:** in Excel on the web, Home, Add-ins, then right-click Aggregate (or use its menu) and choose **Remove**. Clearing Safari's website data for office.com also removes it.
- Delete `aggregate-manifest.xml` from Downloads.
