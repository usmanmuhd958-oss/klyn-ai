package telemetry

import (
	"context"

	"github.com/klyn-ai/klyn-core/pkg/types"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type Logger struct {
	zapLogger *zap.Logger
}

func NewLogger(env string) (*Logger, error) {
	var config zap.Config
	if env == "production" {
		config = zap.NewProductionConfig()
		config.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	} else {
		config = zap.NewDevelopmentConfig()
		config.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	}

	l, err := config.Build()
	if err != nil {
		return nil, err
	}

	return &Logger{zapLogger: l}, nil
}

func (l *Logger) WithContext(ctx context.Context) *zap.Logger {
	fields := make([]zap.Field, 0, 3)

	if mID, ok := types.MissionIDFromContext(ctx); ok {
		fields = append(fields, zap.String("mission_id", mID.String()))
	}
	if eID, ok := types.ExecutionIDFromContext(ctx); ok {
		fields = append(fields, zap.String("execution_id", eID.String()))
	}
	if aID, ok := types.ActorIDFromContext(ctx); ok {
		fields = append(fields, zap.String("actor_id", aID.String()))
	}

	return l.zapLogger.With(fields...)
}

func (l *Logger) Sync() error {
	if l == nil || l.zapLogger == nil {
		return nil
	}
	return l.zapLogger.Sync()
}

func (l *Logger) Logger() *zap.Logger {
	if l == nil {
		return zap.NewNop()
	}
	return l.zapLogger
}
