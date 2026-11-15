# Uploading rides straight to Strava (research, Nov 2026)

## How it works
1. **Connect once (OAuth).** The profile's "Connect Strava" button sends you to `https://www.strava.com/oauth/authorize` with scope `activity:write`. Strava redirects back with a `code`. The app exchanges it at `POST https://www.strava.com/oauth/token` for an access token (6 h) and a refresh token, and stores both in the profile.
2. **Upload after Finish.** `POST https://www.strava.com/api/v3/uploads` (multipart) with `file` = the ride's .fit, `data_type=fit`, `trainer=1`, `sport_type=VirtualRide`, plus `name` and `external_id`. Strava processes uploads asynchronously, so poll `GET /api/v3/uploads/{id}` until `activity_id` appears, then link to `https://www.strava.com/activities/{activity_id}`.
3. **Refresh** the access token with the refresh token whenever it has expired.

## Constraints that shape the design
- **A Strava API app is required.** Create one at https://www.strava.com/settings/api. New apps start in *Single Player Mode* (athlete capacity 1), which is enough for your own rides.
- **Subscription:** since June 2026 the Standard API tier needs a Strava subscription (new developers from June 1, existing ones from June 30).
- **No backend, no PKCE.** Strava's token exchange needs the app's `client_secret`, and Strava doesn't offer PKCE for public clients. A static GitHub Pages app can't hide a secret, so the secret is entered by you and kept only in your browser's profile, never committed. That's acceptable for a personal Single-Player app; a public multi-user app would need a tiny token-exchange proxy (e.g. a Cloudflare Worker).
- **CORS:** the API (`/api/v3/*`, incl. uploads) accepts browser requests. Browser calls to `/oauth/token` have historically been flaky, so this must be tested; if it fails, use the Worker proxy above.
- **Redirect:** set the API app's *Authorization Callback Domain* to `mattserrao.github.io` (and `localhost` for local testing).
- **Coming June 1 2027:** tokens must be sent in headers (already planned) and the base URL becomes `https://www.api-v3.strava.com`, so the base URL lives in one constant.
- **Fallback stays:** "Save & download .fit" plus https://www.strava.com/upload/select keeps working with no setup.

## Proposed UI
Profile › **Strava**: Client ID + Client secret fields (with a link to set up the API app) → **Connect Strava** → shows "Connected as <athlete>" with **Disconnect**. Option: *Upload automatically after each ride*. The summary's primary button becomes **Save & upload to Strava**, which shows progress, then "View on Strava".
