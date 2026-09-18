package types_test

import (
	"errors"
	"testing"

	"github.com/klyn-ai/klyn-core/pkg/types"
	"github.com/stretchr/testify/assert"
)

func TestMissionIDParsing(t *testing.T) {
	id := types.NewMissionID()
	parsed, err := types.ParseMissionID(id.String())

	assert.NoError(t, err)
	assert.Equal(t, id.String(), parsed.String())
	assert.False(t, parsed.IsNil())

	_, err = types.ParseMissionID("invalid-uuid-string")
	assert.Error(t, err)
}

func TestAllDomainIDsHaveStableRoundTrip(t *testing.T) {
	tests := []struct {
		name   string
		newID  func() string
		parse  func(string) (string, error)
	}{
		{"mission", func() string { return types.NewMissionID().String() }, func(s string) (string, error) { v, e := types.ParseMissionID(s); return v.String(), e }},
		{"execution", func() string { return types.NewExecutionID().String() }, func(s string) (string, error) { v, e := types.ParseExecutionID(s); return v.String(), e }},
		{"agent", func() string { return types.NewAgentID().String() }, func(s string) (string, error) { v, e := types.ParseAgentID(s); return v.String(), e }},
		{"sandbox", func() string { return types.NewSandboxID().String() }, func(s string) (string, error) { v, e := types.ParseSandboxID(s); return v.String(), e }},
		{"artifact", func() string { return types.NewArtifactID().String() }, func(s string) (string, error) { v, e := types.ParseArtifactID(s); return v.String(), e }},
		{"event", func() string { return types.NewEventID().String() }, func(s string) (string, error) { v, e := types.ParseEventID(s); return v.String(), e }},
		{"credential", func() string { return types.NewCredentialID().String() }, func(s string) (string, error) { v, e := types.ParseCredentialID(s); return v.String(), e }},
		{"policy", func() string { return types.NewPolicyID().String() }, func(s string) (string, error) { v, e := types.ParsePolicyID(s); return v.String(), e }},
		{"transition", func() string { return types.NewTransitionID().String() }, func(s string) (string, error) { v, e := types.ParseTransitionID(s); return v.String(), e }},
		{"checkpoint", func() string { return types.NewCheckpointID().String() }, func(s string) (string, error) { v, e := types.ParseCheckpointID(s); return v.String(), e }},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := tc.newID()
			parsed, err := tc.parse(s)
			assert.NoError(t, err)
			assert.Equal(t, s, parsed)
		})
	}
}

func TestControlPlaneErrorMatching(t *testing.T) {
	baseErr := types.NewError(
		types.ErrStateConflict,
		"fsm_engine",
		"optimistic concurrency failure",
		types.SentinelStateConflict,
	)

	assert.True(t, errors.Is(baseErr, types.SentinelStateConflict))
	assert.False(t, errors.Is(baseErr, types.SentinelInvalidTransition))

	var cpErr *types.ControlPlaneError
	assert.True(t, errors.As(baseErr, &cpErr))
	assert.Equal(t, types.ErrStateConflict, cpErr.Code)
}
