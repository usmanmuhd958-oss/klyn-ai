package config_test

import (
	"testing"
	"time"

	"github.com/klyn-ai/klyn-core/pkg/config"
	"github.com/stretchr/testify/assert"
)

func TestValidConfiguration(t *testing.T) {
	raw := config.ControlPlaneConfig{
		Environment: "development",
		Database: config.DatabaseConfig{
			URL: "postgres://user:pass@localhost:5432/klyn?sslmode=disable",
		},
		MaxCredentialTTL:     10 * time.Minute,
		MerkleCheckpointFreq: 100,
	}

	holder, err := config.NewImmutableConfig(raw)
	assert.NoError(t, err)
	assert.NotNil(t, holder)
	assert.Equal(t, raw.Database.URL, holder.Get().Database.URL)

	var reader config.ConfigReader = holder
	assert.Equal(t, raw.MerkleCheckpointFreq, reader.Get().MerkleCheckpointFreq)
}

func TestExcessiveCredentialTTLRejected(t *testing.T) {
	raw := config.ControlPlaneConfig{
		Environment: "development",
		Database: config.DatabaseConfig{
			URL: "postgres://user:pass@localhost:5432/klyn?sslmode=disable",
		},
		MaxCredentialTTL:     20 * time.Minute,
		MerkleCheckpointFreq: 100,
	}

	_, err := config.NewImmutableConfig(raw)
	assert.Error(t, err)
}
