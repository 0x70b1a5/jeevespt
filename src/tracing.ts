import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const exporter = new OTLPTraceExporter({
  url: process.env.BETTERSTACK_TRACES_URL,
  headers: {
    Authorization: `Bearer ${process.env.BETTERSTACK_SOURCE_TOKEN}`,
  },
});

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
