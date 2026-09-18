package types

import "context"

type contextKey string

const (
	missionIDKey   contextKey = "klyn.mission_id"
	executionIDKey contextKey = "klyn.execution_id"
	actorIDKey     contextKey = "klyn.actor_id"
)

func WithMissionID(ctx context.Context, id MissionID) context.Context {
	return context.WithValue(ctx, missionIDKey, id)
}

func MissionIDFromContext(ctx context.Context) (MissionID, bool) {
	id, ok := ctx.Value(missionIDKey).(MissionID)
	return id, ok
}

func WithExecutionID(ctx context.Context, id ExecutionID) context.Context {
	return context.WithValue(ctx, executionIDKey, id)
}

func ExecutionIDFromContext(ctx context.Context) (ExecutionID, bool) {
	id, ok := ctx.Value(executionIDKey).(ExecutionID)
	return id, ok
}

func WithActorID(ctx context.Context, id AgentID) context.Context {
	return context.WithValue(ctx, actorIDKey, id)
}

func ActorIDFromContext(ctx context.Context) (AgentID, bool) {
	id, ok := ctx.Value(actorIDKey).(AgentID)
	return id, ok
}
