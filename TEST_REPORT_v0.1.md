# v0.1 validation — 2026-10-18

- Syntax checks and 21 Node logic tests pass.
- Generic browser integration: 14 scenarios pass, including automatic execution with verified=false, confirmation and official-record matching, duplicate prevention, authentication changes and uncertain-result locks.
- Native browser regression covers first automatic execution without dry-run, account binding before duplicate-key generation, failed closed-period dry-run followed by a scheduled automatic run, unavailable slots and fallback, account/location mismatches, preset starts before release, all three mode preferences across reset/reopen, and one-off dry-run preserving the preference.
- All booking tests route requests to isolated mock pages. No live booking is submitted.
- Current product: fkHKUST-booking-system; release tag v0.1; manifest numeric version 0.1.0; display version 0.1.
- Local dedicated browser checked with the renamed product. The rules count before and after reload/restart was zero.
