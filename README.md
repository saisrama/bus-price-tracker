# Bus Fare Tracker

A local dashboard and scheduled collector for Volvo and Scania buses on Bengaluru ↔ Hyderabad. It stores each observed fare and available-seat count in SQLite and graphs changes over time. The bus-type filter includes every listing containing **Volvo** or **Scania**, including B11R, 9600, and other models.

## Run

Requires Node.js 24 or newer. No package installation is needed.

```powershell
npm.cmd start
```

Open `http://127.0.0.1:3030`. Keep the process running to collect automatically. Data is stored in `data/tracker.sqlite`; the dashboard binds to localhost only. To start it automatically when you sign in to Windows, run `powershell -File scripts/install-startup-task.ps1` from this folder. That registers a user-level Windows Task Scheduler task. The computer must be on and signed in for capture to continue.

On this computer, the **Bus Fare Tracker** startup task has already been installed. Leave the computer awake and signed in; locking the screen is fine. Use `Get-ScheduledTask -TaskName 'Bus Fare Tracker'` to check it, `Start-ScheduledTask -TaskName 'Bus Fare Tracker'` to start it, and `Stop-ScheduledTask -TaskName 'Bus Fare Tracker'` to stop it. Avoid running `npm.cmd start` at the same time as the task because both processes would try to serve port 3030 and collect the same dates. The SQLite database is intentionally excluded from Git, so a clone on another computer starts with an empty history.

The dashboard shows the latest Volvo/Scania listings, lowest and median route fares, each service's fare and seat history, collection errors, and CSV export. It never inserts sample fares into the real database.

## Collection

The collector requests the route results currently used by redBus's web page at `/rpw/api/searchResults`. It searches both directions for travel dates today through seven days ahead, follows result pages and grouped operators, and stores only Volvo/Scania listings. It records the lowest and highest fares in each listed fare set. It collects every 12 hours seven to three days out, every six hours through the next two days, every three hours in the final day, and hourly on the departure day. A source error stops the current cycle and triggers a 30-minute cooldown. Any listings captured before the error are retained with a **partial** label. The dashboard displays the failure.

The **Collect now** button refreshes the selected route and date. To collect every date currently due, run `npm.cmd run collect`. To test one route and date:

```powershell
npm.cmd run collect:one -- BLR-HYD 2026-10-05
```

Run `npm.cmd test` for parser, storage, model-filter, and cadence tests.

## Current source limitations

This is an unofficial integration with a site endpoint that may change or reject automated requests. Live collection was verified on 28 September 2026 and populated the local database. Some requests were reset or timed out; the collector retries transient transport failures and reports partial runs. Check the dashboard's source status before depending on a specific date's coverage. The app records failures rather than showing invented data.

Gender-restricted available-seat counts are recorded only if the results response explicitly includes them. The verified results response did not include those counts. The seat map has not been integrated, so these fields remain blank for now. The displayed fare is the lowest in the result's fare list, not necessarily the final seat-level payable amount. The full source listing is retained in the database for later analysis.

The collector can identify only listings that explicitly name Volvo or Scania in the bus type; a branded coach listed under a marketing name alone may be missed. It starts seven days ahead and cannot reconstruct prices before its first observation. The booking-time prediction model is not trained yet; it needs accumulated completed trips and a holiday/festival calendar before its advice can be validated. The dashboard is local to this computer and has no remote hosting or alert delivery.

The collector does not solve CAPTCHAs, rotate identities or IPs, or defeat access challenges. It uses a bounded request rate and a cooldown on failure. redBus may restrict the endpoint or change its terms; review the [redBus user agreement](https://www.redbus.in/info/useragreement) and [robots.txt](https://www.redbus.in/robots.txt) before running unattended collection.
