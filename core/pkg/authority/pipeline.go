package authority

import (
	"context"

	"github.com/klyn-ai/klyn-core/pkg/types"
)

type Step string

const (
	StepPropose      Step = "PROPOSE"
	StepAuthenticate Step = "AUTHENTICATE"
	StepAuthorize    Step = "AUTHORIZE"
	StepAllocate     Step = "ALLOCATE"
	StepAdmit        Step = "ADMIT"
	StepIsolate      Step = "ISOLATE"
	StepExecute      Step = "EXECUTE"
	StepVerify       Step = "VERIFY"
	StepCommit       Step = "COMMIT"
)

type Proposal struct {
	MissionID   types.MissionID
	ExecutionID types.ExecutionID
	AgentID     types.AgentID
	Action      string
	Payload     []byte
}

type ExecutionResult struct {
	Success    bool
	ArtifactID types.ArtifactID
	Output     []byte
	Error      *types.ControlPlaneError
}

type DeterministicAuthority interface {
	ProcessProposal(ctx context.Context, prop Proposal) (*ExecutionResult, error)
}
