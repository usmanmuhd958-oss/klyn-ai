package types

import (
	"errors"
	"fmt"
	"time"
)

type ErrorCode string

const (
	ErrUnauthorized        ErrorCode = "ERR_UNAUTHORIZED"
	ErrEnvelopeExhausted   ErrorCode = "ERR_ENVELOPE_EXHAUSTED"
	ErrEnvelopeExpired     ErrorCode = "ERR_ENVELOPE_EXPIRED"
	ErrStateConflict       ErrorCode = "ERR_STATE_CONFLICT"
	ErrInvalidTransition   ErrorCode = "ERR_INVALID_TRANSITION"
	ErrLedgerTamper        ErrorCode = "ERR_LEDGER_TAMPER"
	ErrCircuitBreakerHalt  ErrorCode = "ERR_CIRCUIT_BREAKER_HALT"
	ErrWorkerDead          ErrorCode = "ERR_WORKER_DEAD"
	ErrVerificationFailed ErrorCode = "ERR_VERIFICATION_FAILED"
	ErrInternal            ErrorCode = "ERR_INTERNAL"
)

var (
	SentinelStateConflict     = errors.New("state conflict: optimistic concurrency mismatch")
	SentinelInvalidTransition = errors.New("invalid state transition requested")
	SentinelLedgerTamper      = errors.New("ledger cryptographic chain failure")
	SentinelUnauthorized      = errors.New("unauthorized action attempt")
)

type ControlPlaneError struct {
	Code      ErrorCode              `json:"code"`
	Message   string                 `json:"message"`
	Component string                 `json:"component"`
	Timestamp time.Time              `json:"timestamp"`
	Details   map[string]interface{} `json:"details,omitempty"`
	Err       error                  `json:"-"`
}

func (e *ControlPlaneError) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.Err != nil {
		return fmt.Sprintf("[%s] %s: %s (cause: %v)", e.Code, e.Component, e.Message, e.Err)
	}
	return fmt.Sprintf("[%s] %s: %s", e.Code, e.Component, e.Message)
}

func (e *ControlPlaneError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *ControlPlaneError) Is(target error) bool {
	if e == nil || target == nil {
		return false
	}

	switch e.Code {
	case ErrStateConflict:
		return errors.Is(target, SentinelStateConflict)
	case ErrInvalidTransition:
		return errors.Is(target, SentinelInvalidTransition)
	case ErrLedgerTamper:
		return errors.Is(target, SentinelLedgerTamper)
	case ErrUnauthorized:
		return errors.Is(target, SentinelUnauthorized)
	default:
		return false
	}
}

func NewError(code ErrorCode, component, msg string, err error) *ControlPlaneError {
	return &ControlPlaneError{
		Code:      code,
		Message:   msg,
		Component: component,
		Timestamp: time.Now().UTC(),
		Details:   make(map[string]interface{}),
		Err:       err,
	}
}
