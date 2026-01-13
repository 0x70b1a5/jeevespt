import dotenv from "dotenv";
dotenv.config(); // Must load env vars before using them

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

// Enable verbose OpenTelemetry diagnostic logging
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

// Debug: log the config being used
const tracesUrl = process.env.BETTERSTACK_TRACES_URL;
const token = process.env.BETTERSTACK_SOURCE_TOKEN;
// Build the full URL with protocol and path
let fullUrl = tracesUrl || "";
if (!fullUrl.startsWith("http")) {
  fullUrl = `https://${fullUrl}`;
}
if (!fullUrl.endsWith("/v1/traces")) {
  fullUrl = fullUrl.replace(/\/$/, "") + "/v1/traces";
}

console.log(`[TRACING] Full URL: ${fullUrl}`);
console.log(`[TRACING] Token: ${token ? token.substring(0, 8) + "..." : "NO - MISSING!"}`);
if (!tracesUrl || !token) {
  console.warn("[TRACING] WARNING: Better Stack tracing not fully configured - traces will not be sent");
}

// Disable metrics and logs exporters (we only want traces)
process.env.OTEL_METRICS_EXPORTER = "none";
process.env.OTEL_LOGS_EXPORTER = "none";

// Set OTEL env vars - the exporter reads these directly
process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = fullUrl;
process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = `Authorization=Bearer ${token}`;

console.log(`[TRACING] Set OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${fullUrl}`);
console.log(`[TRACING] Disabled metrics and logs exporters`);

const exporter = new OTLPTraceExporter();

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "jeevespt",
    [ATTR_SERVICE_VERSION]: "1.0.0",
    "deployment.environment": process.env.NODE_ENV || "development",
  }),
  traceExporter: exporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Only instrument what we actually use
      "@opentelemetry/instrumentation-http": { enabled: true },
      "@opentelemetry/instrumentation-undici": { enabled: true }, // Node fetch
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
    }),
  ],
});

sdk.start();
console.log("OpenTelemetry tracing initialized");

// Graceful shutdown
process.on("SIGTERM", () => {
  sdk.shutdown()
    .then(() => console.log("Tracing terminated"))
    .catch((err) => console.error("Error shutting down tracing", err))
    .finally(() => process.exit(0));
});

export { sdk };
