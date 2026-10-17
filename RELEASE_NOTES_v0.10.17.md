# v0.10.17

Initial public release of the local HKUST FBS browser extension.

- Native adapter for the current FBS facility booking pages.
- Local settings for facility, location, date rules, preferred times, and fallback times.
- Dry-run stops before final booking confirmation.
- Automatic mode includes pre-submit record checks, duplicate protection, and conservative handling of uncertain results.
- English and Simplified Chinese usage documentation.

Validation: 17 logic tests, 14 generic browser integration scenarios, and 10 native-adapter mock browser scenarios pass. A live-site badminton dry-run was checked through the final confirmation dialog; no real booking was submitted. See the README for supported scope and limitations.
