import 'dotenv/config';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// This module must be imported before Nest and database/broker clients.
const sdk = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? new NodeSDK({
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
          '@opentelemetry/instrumentation-net': { enabled: false },
        }),
      ],
    })
  : undefined;
sdk?.start();
export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
}
