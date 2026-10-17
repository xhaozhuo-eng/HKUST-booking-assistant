# HKUST Booking Assistant

An open-source browser extension that runs locally in Chrome or Edge and configures booking rules for the HKUST Sports Facility Booking System (FBS). It uses a session that you establish yourself in the browser; you do not give your password to the extension or a remote server.

## How to use

1. Download this project. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable Developer mode, choose **Load unpacked**, and select this folder (the folder should directly contain `manifest.json`).
3. Open the extension settings and start HKUST sign-in. Complete sign-in and any MFA yourself on the official website.
4. Sync the official facility list, then select a facility category, location, and venue. Configure the target date, preferred and fallback times, priority, and opening time.
5. Run Dry-run first and verify the selected venue, date, and time. Dry-run stops before the final booking confirmation.
6. Only after checking the applicable HKUST rules and understanding the risks, choose automatic mode, authorize actions for your own account, and enable the task.
7. Keep the browser open, the computer awake, and the network available. If authentication expires or the site presents CAPTCHA/MFA, an unknown page, or an uncertain result, the extension stops for manual handling.

The default timezone is `Asia/Hong_Kong`, opening time is 08:00 daily, and the default target date is seven calendar days after the execution date. If the site has not exposed its time controls yet, the settings page offers preset hourly choices from 08:00 through 21:00; every choice is checked against the live site at execution time. You can change these settings. Browser alarms may be delayed; a sleeping or closed computer cannot run a task.

## Supported website and scope

- Target: the current HKUST Sports Facility Booking System for current students, staff, and alumni: `https://fbs.hkust.edu.hk/facilities`.
- Booking records: `https://fbs.hkust.edu.hk/bookings`.
- The adapter reads facility categories, venues, locations, dates, and times from the live page. It does not rely on fixed coordinates or transient DOM IDs.
- A representative badminton workflow was checked on the authenticated current website through a dry-run, including duplicate venue names at different locations, date, time, and the final confirmation dialog. No real booking was submitted.
- Automatic submission and record reconciliation are tested against isolated mock pages. Facility-specific requirements, real success/failure dialogs, and non-empty record formats have not all been tested on the live site.
- The legacy family member / Sports Facilities User Card site (`w5.ab.ust.hk/fbs_user/`) is not currently supported by this adapter.

## Privacy and security

- The extension does not read or store passwords or export cookies. You sign in on the official site yourself.
- Rules, run history, and idempotency records are stored in the current browser's local extension storage.
- Do not share browser profile directories, extension storage, logs, screenshots, or diagnostic output; they may contain account or booking information.
- Never commit real account data, browser profiles, a `data/` directory, or private build artifacts to a public repository.
- The extension does not bypass CAS, MFA, CAPTCHA, access controls, or anti-abuse measures. It stops when the page or result is uncertain.

## Disclaimer

This is an independent community project. **It is not an official HKUST product and is not endorsed by HKUST.** HKUST and system names are used only to identify the intended compatibility target.

The maintainers do not guarantee website availability, compatibility, timing, booking success, accurate interpretation of facility rules, or error-free operation. The website, booking rules, and terms may change. You are responsible for reviewing and complying with the current HKUST terms before use. Confirm that automation is permitted; do not enable automatic submission if the applicable terms prohibit it.

You are responsible for checking every rule and using the software only as yourself and with your own authorization. The software is provided “as is.” To the extent permitted by applicable law, the authors and contributors disclaim warranties and liability for losses or consequences arising from use or inability to use the software, including missed or duplicate bookings and account restrictions. This does not exclude rights or liabilities that cannot be excluded under local law.

## Development and tests

```bash
npm ci
npm run check
npm test
npm run test:browser
npm run test:native
```

Browser integration tests use mock pages. They do not sign into or submit bookings to a real account. Install a Playwright browser as described in the official Playwright documentation if needed.

## License

Project code is released under the MIT License included in this repository. This license does not grant rights to HKUST trademarks, website content, or third-party dependencies.
