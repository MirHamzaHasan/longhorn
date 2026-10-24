// Verification owns its report backend; ambient opt-in settings must not acquire external services.
export const localReportTestEnvironment = Object.freeze({
  REPORTS_NATIVE_URL: '', REPORTS_NATIVE_TOKEN: '',
  REPORTS_NATIVE_ALLOW_INSECURE_LOOPBACK: 'false', REPORTS_NATIVE_TIMEOUT_MS: '2000',
})
