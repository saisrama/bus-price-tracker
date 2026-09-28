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

## Run while your computer is off (free services)

The hosted setup uses **Vercel Hobby** for the dashboard, **GitHub Actions** for hourly collection, and **Neon Free Postgres** for durable observations. Vercel Hobby's own cron is limited to once daily, so the scheduled collector runs on GitHub instead. The repository is public so standard GitHub-hosted Actions minutes are free; never put database credentials in Git or workflow logs. No redBus account is used.

1. Create a free Neon Postgres database and copy its connection string. Choose a region close to India if offered. The free storage allowance is limited, and each observation retains raw listing JSON, so monitor usage.
2. In GitHub, open this repository's **Settings → Secrets and variables → Actions → New repository secret**. Add `DATABASE_URL` with the Neon connection string. The [hourly workflow](.github/workflows/collect.yml) runs at minute 17 UTC and can also be started with **Actions → Collect bus fares → Run workflow**. It skips collection until the secret exists. Confirm its first run logs a nonzero bus count; source access from GitHub runners is unverified.
3. To copy the history already on this computer, set `DATABASE_URL` only in your local PowerShell session and run `npm.cmd run migrate:local`. The command imports runs and observations from `data/tracker.sqlite` and can be rerun without duplicating them. Do not paste the URL into a committed file.
4. In Vercel, import this GitHub repository into a Hobby project. Leave the Framework Preset as **Other**; `vercel.json` serves `public/` and the `api/` functions. Set the same `DATABASE_URL` as a Vercel environment variable for Production, then deploy. Check `/api/config`, `/api/data`, and the graphs on the deployed URL. This dashboard is publicly viewable; it does not expose the raw source JSON or database password.
5. Only after the cloud workflow and dashboard both show new observations, stop the local **Bus Fare Tracker** Windows task if you no longer need it: `Stop-ScheduledTask -TaskName 'Bus Fare Tracker'`. The local SQLite database remains intact.

GitHub scheduled jobs can run late or be skipped, and redBus may block data-center IPs. A successful deployment therefore does not prove collection works until a cloud workflow completes with listings. The collector records errors in the dashboard, but the current setup does not send alerts. Review GitHub Actions and Neon usage periodically. The raw JSON will eventually fill Neon's free storage; export or prune old data before it reaches the limit.

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

The collector can identify only listings that explicitly name Volvo or Scania in the bus type; a branded coach listed under a marketing name alone may be missed. It starts seven days ahead and cannot reconstruct prices before its first observation. The booking-time prediction model is not trained yet; it needs accumulated completed trips and a holiday/festival calendar before its advice can be validated. The local dashboard binds to this computer; the Vercel deployment is separate and reads the cloud database. Neither setup currently sends alerts.

The collector does not solve CAPTCHAs, rotate identities or IPs, or defeat access challenges. It uses a bounded request rate and a cooldown on failure. redBus may restrict the endpoint or change its terms; review the [redBus user agreement](https://www.redbus.in/info/useragreement) and [robots.txt](https://www.redbus.in/robots.txt) before running unattended collection.
