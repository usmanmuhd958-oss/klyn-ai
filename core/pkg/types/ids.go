package types

import (
	"database/sql/driver"
	"fmt"

	"github.com/google/uuid"
)

type MissionID struct{ id uuid.UUID }
type ExecutionID struct{ id uuid.UUID }
type AgentID struct{ id uuid.UUID }
type SandboxID struct{ id uuid.UUID }
type ArtifactID struct{ id uuid.UUID }
type EventID struct{ id uuid.UUID }
type CredentialID struct{ id uuid.UUID }
type PolicyID struct{ id uuid.UUID }
type TransitionID struct{ id uuid.UUID }
type CheckpointID struct{ id uuid.UUID }

func scanUUID(value any) (uuid.UUID, error) {
	switch v := value.(type) {
	case uuid.UUID:
		return v, nil
	case [16]byte:
		return uuid.UUID(v), nil
	case []byte:
		if len(v) == 16 {
			u, err := uuid.FromBytes(v)
			if err != nil {
				return uuid.Nil, err
			}
			return u, nil
		}
		u, err := uuid.Parse(string(v))
		if err != nil {
			return uuid.Nil, err
		}
		return u, nil
	case string:
		u, err := uuid.Parse(v)
		if err != nil {
			return uuid.Nil, err
		}
		return u, nil
	default:
		return uuid.Nil, fmt.Errorf("cannot scan type %T into UUID", value)
	}
}

func NewMissionID() MissionID       { return MissionID{id: uuid.New()} }
func NilMissionID() MissionID       { return MissionID{id: uuid.Nil} }
func (m MissionID) String() string  { return m.id.String() }
func (m MissionID) UUID() uuid.UUID { return m.id }
func (m MissionID) IsNil() bool     { return m.id == uuid.Nil }
func ParseMissionID(s string) (MissionID, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return NilMissionID(), fmt.Errorf("invalid MissionID: %w", err)
	}
	return MissionID{id: u}, nil
}
func (m MissionID) Value() (driver.Value, error) { return m.id.String(), nil }
func (m *MissionID) Scan(value any) error {
	u, err := scanUUID(value)
	if err != nil {
		return err
	}
	m.id = u
	return nil
}

func NewExecutionID() ExecutionID       { return ExecutionID{id: uuid.New()} }
func NilExecutionID() ExecutionID       { return ExecutionID{id: uuid.Nil} }
func (e ExecutionID) String() string    { return e.id.String() }
func (e ExecutionID) UUID() uuid.UUID   { return e.id }
func (e ExecutionID) IsNil() bool       { return e.id == uuid.Nil }
func ParseExecutionID(s string) (ExecutionID, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return NilExecutionID(), fmt.Errorf("invalid ExecutionID: %w", err)
	}
	return ExecutionID{id: u}, nil
}
func (e ExecutionID) Value() (driver.Value, error) { return e.id.String(), nil }
func (e *ExecutionID) Scan(value any) error {
	u, err := scanUUID(value)
	if err != nil {
		return err
	}
	e.id = u
	return nil
}

func NewAgentID() AgentID       { return AgentID{id: uuid.New()} }
func NilAgentID() AgentID       { return AgentID{id: uuid.Nil} }
func (a AgentID) String() string { return a.id.String() }
func (a AgentID) UUID() uuid.UUID { return a.id }
func (a AgentID) IsNil() bool    { return a.id == uuid.Nil }
func ParseAgentID(s string) (AgentID, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return NilAgentID(), fmt.Errorf("invalid AgentID: %w", err)
	}
	return AgentID{id: u}, nil
}
func (a AgentID) Value() (driver.Value, error) { return a.id.String(), nil }
func (a *AgentID) Scan(value any) error {
	u, err := scanUUID(value)
	if err != nil {
		return err
	}
	a.id = u
	return nil
}

func NewSandboxID() SandboxID       { return SandboxID{id: uuid.New()} }
func NilSandboxID() SandboxID       { return SandboxID{id: uuid.Nil} }
func (s SandboxID) String() string  { return s.id.String() }
func (s SandboxID) UUID() uuid.UUID { return s.id }
func (s SandboxID) IsNil() bool     { return s.id == uuid.Nil }
func ParseSandboxID(v string) (SandboxID, error) {
	u, err := uuid.Parse(v)
	if err != nil {
		return NilSandboxID(), fmt.Errorf("invalid SandboxID: %w", err)
	}
	return SandboxID{id: u}, nil
}
func (s SandboxID) Value() (driver.Value, error) { return s.id.String(), nil }
func (s *SandboxID) Scan(value any) error {
	u, err := scanUUID(value)
	if err != nil {
		return err
	}
	s.id = u
	return nil
}

func NewArtifactID() ArtifactID       { return ArtifactID{id: uuid.New()} }
func NilArtifactID() ArtifactID       { return ArtifactID{id: uuid.Nil} }
func (a ArtifactID) String() string   { return a.id.String() }
func (a ArtifactID) UUID() uuid.UUID  { return a.id }
func (a ArtifactID) IsNil() bool      { return a.id == uuid.Nil }
func ParseArtifactID(v string) (ArtifactID, error) {
	u, err := uuid.Parse(v)
	if err != nil {
		return NilArtifactID(), fmt.Errorf("invalid ArtifactID: %w", err)
	}
	return ArtifactID{id: u}, nil
}
func (a ArtifactID) Value() (driver.Value, error) { return a.id.String(), nil }
func (a *ArtifactID) Scan(value any) error {
	u, err := scanUUID(value)
	if err != nil {
		return err
	}
	a.id = u
	return nil
}

func NewEventID() EventID       { return EventID{id: uuid.New()} }
func NilEventID() EventID       { return EventID{id: uuid.Nil} }
func (e EventID) String() string { return e.id.String() }
func (e EventID) UUID() uuid.UUID { return e.id }
func (e EventID) IsNil() bool    { return e.id == uuid.Nil }
func ParseEventID(v string) (EventID, error) {
	u, err := uuid.Parse(v)
	if err != nil {
		return NilEventID(), fmt.Errorf("invalid EventID: %w", err)
	}
	return EventID{id: u}, nil
}
func (e EventID) Value() (driver.Value, error) { return e.id.String(), nil }
func (e *EventID) Scan(value any) error {
	u, err := scanUUID(value)
	if err != nil {
		return err
	}
	e.id = u
	return nil
}

func NewCredentialID() CredentialID       { return CredentialID{id: uuid.New()} }
func NilCredentialID() CredentialID       { return CredentialID{id: uuid.Nil} }
func (c CredentialID) String() string     { return c.id.String() }
func (c CredentialID) UUID() uuid.UUID    { return c.id }
func (c CredentialID) IsNil() bool        { return c.id == uuid.Nil }
func ParseCredentialID(v string) (CredentialID, error) {
	u, err := uuid.Parse(v)
	if err != nil {
		return NilCredentialID(), fmt.Errorf("invalid CredentialID: %w", err)
	}
	return CredentialID{id: u}, nil
}
func (c CredentialID) Value() (driver.Value, error) { return c.id.String(), nil }
func (c *CredentialID) Scan(value any) error {
	u, err := scanUUID(value)
	if err != nil {
		return err
	}
	c.id = u
	return nil
}

func NewPolicyID() PolicyID       { return PolicyID{id: uuid.New()} }
func NilPolicyID() PolicyID       { return PolicyID{id: uuid.Nil} }
func (p PolicyID) String() string { return p.id.String() }
func (p PolicyID) UUID() uuid.UUID { return p.id }
func (p PolicyID) IsNil() bool    { return p.id == uuid.Nil }
func ParsePolicyID(v string) (PolicyID, error) {
	u, err := uuid.Parse(v)
	if err != nil {
		return NilPolicyID(), fmt.Errorf("invalid PolicyID: %w", err)
	}
	return PolicyID{id: u}, nil
}
func (p PolicyID) Value() (driver.Value, error) { return p.id.String(), nil }
func (p *PolicyID) Scan(value any) error {
	u, err := scanUUID(value)
	if err != nil {
		return err
	}
	p.id = u
	return nil
}

func NewTransitionID() TransitionID       { return TransitionID{id: uuid.New()} }
func NilTransitionID() TransitionID       { return TransitionID{id: uuid.Nil} }
func (t TransitionID) String() string     { return t.id.String() }
func (t TransitionID) UUID() uuid.UUID    { return t.id }
func (t TransitionID) IsNil() bool        { return t.id == uuid.Nil }
func ParseTransitionID(v string) (TransitionID, error) {
	u, err := uuid.Parse(v)
	if err != nil {
		return NilTransitionID(), fmt.Errorf("invalid TransitionID: %w", err)
	}
	return TransitionID{id: u}, nil
}
func (t TransitionID) Value() (driver.Value, error) { return t.id.String(), nil }
func (t *TransitionID) Scan(value any) error {
	u, err := scanUUID(value)
	if err != nil {
		return err
	}
	t.id = u
	return nil
}

func NewCheckpointID() CheckpointID       { return CheckpointID{id: uuid.New()} }
func NilCheckpointID() CheckpointID       { return CheckpointID{id: uuid.Nil} }
func (c CheckpointID) String() string     { return c.id.String() }
func (c CheckpointID) UUID() uuid.UUID    { return c.id }
func (c CheckpointID) IsNil() bool        { return c.id == uuid.Nil }
func ParseCheckpointID(v string) (CheckpointID, error) {
	u, err := uuid.Parse(v)
	if err != nil {
		return NilCheckpointID(), fmt.Errorf("invalid CheckpointID: %w", err)
	}
	return CheckpointID{id: u}, nil
}
func (c CheckpointID) Value() (driver.Value, error) { return c.id.String(), nil }
func (c *CheckpointID) Scan(value any) error {
	u, err := scanUUID(value)
	if err != nil {
		return err
	}
	c.id = u
	return nil
}
