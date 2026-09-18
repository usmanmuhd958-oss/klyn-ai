package config

import (
	"time"
)

type DatabaseConfig struct {
	URL             string        `json:"url"`
	MaxOpenConns    int           `json:"maxOpenConns"`
	MaxIdleConns    int           `json:"maxIdleConns"`
	ConnMaxLifetime time.Duration `json:"connMaxLifetime"`
}

type SandboxConfig struct {
	FirecrackerBinaryPath string        `json:"firecrackerBinaryPath"`
	KernelImagePath       string        `json:"kernelImagePath"`
	DefaultRootfsPath     string        `json:"defaultRootfsPath"`
	MaxExecutionTTL       time.Duration `json:"maxExecutionTTL"`
}

type ControlPlaneConfig struct {
	Environment          string         `json:"environment"`
	Database             DatabaseConfig `json:"database"`
	Sandbox              SandboxConfig  `json:"sandbox"`
	MaxCredentialTTL     time.Duration  `json:"maxCredentialTTL"`
	MerkleCheckpointFreq uint64         `json:"merkleCheckpointFreq"`
}

type ConfigReader interface {
	Get() ControlPlaneConfig
}

// ConfigHolder publishes a validated configuration snapshot. Because
// ControlPlaneConfig contains only value-semantic fields, Get returns a copy.
// There is intentionally no mutation API.
type ConfigHolder struct {
	cfg ControlPlaneConfig
}

func NewImmutableConfig(raw ControlPlaneConfig) (*ConfigHolder, error) {
	if err := validateConfig(raw); err != nil {
		return nil, err
	}
	return &ConfigHolder{cfg: raw}, nil
}

func (h *ConfigHolder) Get() ControlPlaneConfig {
	return h.cfg
}
