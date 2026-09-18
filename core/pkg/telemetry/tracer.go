package telemetry

import "context"

// Span is the minimal tracing contract consumed by the control plane.
// The concrete OpenTelemetry adapter is injected at runtime so the
// authority layer remains independent of exporter and SDK selection.
type Span interface {
	End()
	RecordError(error)
	SetAttribute(key string, value any)
}

type Tracer interface {
	Start(ctx context.Context, name string) (context.Context, Span)
}
