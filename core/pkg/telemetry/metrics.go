package telemetry

import (
	"context"
	"time"
)

const (
	MetricProposalsTotal      = "klyn.authority.proposals.total"
	MetricProposalFailures    = "klyn.authority.proposals.failures"
	MetricPipelineStepSeconds = "klyn.authority.pipeline.step.duration"
	MetricStateConflicts      = "klyn.fsm.state.conflicts"
	MetricLedgerAppends       = "klyn.ledger.appends"
)

type Metrics interface {
	IncProposal(ctx context.Context)
	IncProposalFailure(ctx context.Context)
	ObservePipelineStep(ctx context.Context, step string, duration time.Duration)
	IncStateConflict(ctx context.Context)
	IncLedgerAppend(ctx context.Context)
}
