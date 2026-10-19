# v0.1.1 validation

- 32 logic tests pass, including simultaneous queued alarms retaining the original target date; durable retry alarms; retry recovery after browser and worker-only restarts; cancellation; deadline exhaustion; disabled retry; terminal authentication/mismatch/uncertain-result handling; and responsive official pages whose loading indicator remains active.
- Generic browser integration: 14 scenarios pass, covering preparation, automatic submission, confirmation and records, duplicate protection, authentication/MFA stops, and uncertain-result locks that prevent another submission.
- Native browser integration: 16 scenarios pass, including an end-to-end scheduled failure when facility options are temporarily missing, followed by automatic retry with the original date and exactly one final submission. Existing closed-period, fallback, account/location, mode-persistence and responsive-layout checks are retained.
- All booking interactions in tests are served by isolated mock pages. No live booking was submitted.
- Default retry window: 600 seconds from the original opening. Default interval: 10 seconds after a failed attempt, subject to browser alarms and other queued tasks. Window and interval are configurable.
- Existing rules without retry fields inherit the defaults. Rule mode and own-account authorization are preserved.
