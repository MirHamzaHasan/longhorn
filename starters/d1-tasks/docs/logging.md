# Logging

Core supplies request IDs and child request loggers. This app uses the default
silent logger; supply an explicit configured logger in src/app.ts to emit request
records. Choose fields/redaction before enabling output. The Node host prints
structured readiness/stop records, without request bodies or native SQL errors.
See [HTTP](http.md) and [development](development.md).
