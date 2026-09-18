package config_test

import (
	"testing"
	"time"

	"github.com/klyn-ai/klyn-core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConfigurationBounds(t *testing.T) {
	base := config.ControlPlaneConfig{
		Environment: "development",
		Database: config.DatabaseConfig{
			URL: "postgres://user:pass@localhost:5432/klyn?sslmode=disable",
		},
		MaxCredentialTTL:     5 * time.Minute,
		MerkleCheckpointFreq: 10,
	}

	_, err := config.NewImmutableConfig(base)
	require.NoError(t, err)

	base.Database.URL = ""
	_, err = config.NewImmutableConfig(base)
	assert.Error(t, err)

	base.Database.URL = "postgres://user:pass@localhost:5432/klyn?sslmode=disable"
	base.MaxCredentialTTL = 0
	_, err = config.NewImmutableConfig(base)
	assert.Error(t, err)

	base.MaxCredentialTTL = 15*time.Minute + time.Nanosecond
	_, err = config.NewImmutableConfig(base)
	assert.Error(t, err)

	base.MaxCredentialTTL = 5 * time.Minute
	base.MerkleCheckpointFreq = 0
	_, err = config.NewImmutableConfig(base)
	assert.Error(t, err)
}
