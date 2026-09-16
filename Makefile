default:
@cargo build --manifest-path 0.kernel/Cargo.toml

build:
cargo build --release --manifest-path 0.kernel/Cargo.toml

bench:
cargo bench --manifest-path 0.kernel/Cargo.toml --bench kernel_bench

test:
cargo test --manifest-path 0.kernel/Cargo.toml

clean:
cargo clean --manifest-path 0.kernel/Cargo.toml
