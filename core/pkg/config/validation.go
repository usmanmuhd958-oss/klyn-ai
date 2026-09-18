package config

import (
	"time"

	"github.com/klyn-ai/klyn-core/pkg/types"
)

func validateConfig(c ControlPlaneConfig) error {
	if c.Database.URL == "" {
		return types.NewError(types.ErrInternal, "config", "Database.URL is strictly required", nil)
	}
	if c.MaxCredentialTTL > 15*time.Minute {
		return types.NewError(types.ErrInternal, "config", "MaxCredentialTTL cannot exceed 15 minutes", nil)
	}
	if c.MaxCredentialTTL <= 0 {
		return types.NewError(types.ErrInternal, "config", "MaxCredentialTTL must be > 0", nil)
	}
	if c.MerkleCheckpointFreq == 0 {
		return types.NewError(types.ErrInternal, "config", "MerkleCheckpointFreq must be > 0", nil)
	}
	return nil
}
