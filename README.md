# Northline Studio Website

Modern Scandinavian-inspired barber shop website with a real backend booking API and admin dashboard.

## Included

- Homepage with brand story, services, team, testimonials, and contact section
- Booking page with:
  - service and barber selection
  - dynamic slot availability by date
  - conflict prevention for overlapping bookings
  - booking confirmation with reference ID
  - upcoming bookings list and cancellation
- Admin dashboard with:
  - barber/day schedule overrides
  - adjustable start and close hours
  - blocked time-slot controls
  - booking list and cancellation actions
- Client portal with:
  - account registration and login
  - email verification before account sign-in
  - secure password reset flow
  - personalized appointment list
  - self-service cancellation for owned bookings
- Local SVG placeholder images for all hero and content placements
- Responsive navigation and layout for desktop/mobile
- Persistent storage in `data/store.json` for cross-device sync on the same server

## Run locally

Install and run:

```bash
cd /Users/loismac/Desktop/starry-mock
npm install
npm start
```

Optional: set a custom admin password before starting:

```bash
export ADMIN_PASSWORD="your-strong-password"
npm start
```

Persistent setup using `.env` (recommended):

```bash
cp .env.example .env
# edit .env and set ADMIN_PASSWORD (+ SMTP settings for real email delivery)
npm start
```

Note: changing text in this README does not change runtime config; the password only changes from environment values loaded at startup (shell env or `.env`).

Then open:

- http://localhost:3000/index.html
- http://localhost:3000/booking.html
- http://localhost:3000/admin.html
- http://localhost:3000/account.html

## Real email delivery (SMTP)

By default, emails are kept in `emailOutbox` for local preview. To send real emails, configure SMTP in `.env`:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM="Northline Studio <your-email@gmail.com>"
```

Notes:

- For Gmail, use an App Password (not your normal account password).
- Set `SMTP_SECURE=true` only when using an SSL/TLS port (usually 465).
- Keep `APP_BASE_URL` set to the URL users open (for verification/reset links).
- You can check current mode at `/api/health` (`emailMode: smtp` or `preview`).

## Notes

- API endpoints are under `/api`.
- Booking, customer, schedule, and email outbox data are persisted in `data/store.json`.
- Admin access is intentionally discreet via a subtle footer link labeled "Studio access".
- Admin APIs are protected and require sign-in on `admin.html`.
- Customer APIs are protected and require client sign-in on `account.html`.
- Verification and reset links are generated against `APP_BASE_URL`.
- Outbound emails are logged in `emailOutbox` with delivery status (`preview`, `queued`, `sent`, `failed`).
- Default admin password is `northline-admin` unless `ADMIN_PASSWORD` is set.
- For production, replace in-memory token sessions and file storage with database-backed auth/storage.
