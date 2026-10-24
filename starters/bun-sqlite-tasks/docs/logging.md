# Logging

The host creates a logger from LOG_LEVEL and APP_NAME. Core attaches a child logger
and request ID; task observations use the request correlation ID. Event failures
log metadata without titles/arbitrary thrown listener values. Normal structured
logging still needs application-owned field/redaction policy. See [HTTP](http.md),
[configuration](configuration.md) and [events](events.md).
